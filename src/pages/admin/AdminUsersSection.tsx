import React, { useCallback, useEffect, useState } from 'react';
import {
  UserPlus,
  Search,
  KeyRound,
  Power,
  Trash2,
  Link2,
  Unlink,
  Edit3,
  X,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { RolePill } from '@/components/BrandCrest';
import type { UserRole } from '@/types';

export const AdminUsersSection: React.FC = () => {
  const { showToast } = useToast();
  const [users, setUsers] = useState<any[]>([]);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Create / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);

  const [formRole, setFormRole] = useState<UserRole>('student');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [className, setClassName] = useState('Grade 5-A');
  const [house, setHouse] = useState('');
  const [allergiesNotes, setAllergiesNotes] = useState('');
  const [staffCode, setStaffCode] = useState('');
  const [department, setDepartment] = useState('General Academics');
  const [station, setStation] = useState('Main Canteen Kitchen');
  const [address, setAddress] = useState('');
  const [linkedParentId, setLinkedParentId] = useState<string>('');

  // Link Parent-Student Modal
  const [linkParentUserId, setLinkParentUserId] = useState<string>('');
  const [linkStudentUserId, setLinkStudentUserId] = useState<string>('');
  const [linkRelation, setLinkRelation] = useState('Mother');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (roleFilter !== 'all') params.set('role', roleFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());

      const res = await apiFetch<{ users: any[] }>(`/api/admin/users?${params.toString()}`);
      setUsers(res.users);
    } catch (err: any) {
      showToast('Failed to load users', 'error', err.message);
    } finally {
      setLoading(false);
    }
  }, [roleFilter, statusFilter, search, showToast]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openCreateModal = () => {
    setEditingUser(null);
    setFormRole('student');
    setFullName('');
    setUsername('');
    setPassword('');
    setEmail('');
    setPhone('');
    setStudentCode('');
    setClassName('Grade 5-A');
    setHouse('');
    setAllergiesNotes('');
    setStaffCode('');
    setDepartment('General Academics');
    setStation('Main Canteen Kitchen');
    setAddress('');
    setLinkedParentId('');
    setModalOpen(true);
  };

  const openEditModal = (u: any) => {
    setEditingUser(u);
    setFormRole(u.role);
    setFullName(u.fullName || '');
    setUsername(u.username || '');
    setPassword('');
    setEmail(u.email || '');
    setPhone(u.phone || '');
    setStudentCode(u.studentCode || '');
    setClassName(u.className || 'Grade 5-A');
    setHouse(u.house || '');
    setAllergiesNotes(u.allergiesNotes || '');
    setStaffCode(u.staffCode || '');
    setDepartment(u.department || 'General Academics');
    setStation(u.station || 'Main Canteen Kitchen');
    setAddress(u.address || '');
    setModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await apiFetch(`/api/admin/users/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            fullName,
            username,
            email,
            phone,
            studentCode,
            className,
            house,
            allergiesNotes,
            staffCode,
            department,
            station,
            address,
          }),
        });
        showToast('User updated', 'success', `${fullName} saved.`);
      } else {
        await apiFetch('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            role: formRole,
            fullName,
            username,
            password,
            email,
            phone,
            studentCode: studentCode || undefined,
            className,
            house,
            allergiesNotes,
            staffCode: staffCode || undefined,
            department,
            station,
            address,
            linkedParentIds: linkedParentId ? [Number(linkedParentId)] : undefined,
          }),
        });
        showToast('Account Created!', 'success', `${fullName} (${formRole}) registered.`);
      }
      setModalOpen(false);
      loadUsers();
    } catch (err: any) {
      showToast('Failed to save user', 'error', err.message);
    }
  };

  const handleToggleActive = async (u: any) => {
    try {
      await apiFetch(`/api/admin/users/${u.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      showToast(u.isActive ? 'Account Deactivated' : 'Account Activated', 'info', u.fullName);
      loadUsers();
    } catch (err: any) {
      showToast('Action failed', 'error', err.message);
    }
  };

  const handleResetPassword = async (u: any) => {
    const newPassword = window.prompt(
      `Enter a new password (minimum 8 characters) for ${u.fullName} (@${u.username}):`
    );
    if (!newPassword) return;
    try {
      await apiFetch(`/api/admin/users/${u.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      });
      showToast('Password Reset', 'success', `Active sessions revoked for ${u.username}.`);
    } catch (err: any) {
      showToast('Reset failed', 'error', err.message);
    }
  };

  const handleDeleteUser = async (u: any) => {
    if (!window.confirm(`Delete account "${u.fullName}" (@${u.username})?`)) return;
    try {
      await apiFetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      showToast('User Deleted', 'info', u.username);
      loadUsers();
    } catch (err: any) {
      showToast('Cannot delete user', 'error', err.message);
    }
  };

  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkParentUserId || !linkStudentUserId) return;
    try {
      await apiFetch('/api/admin/parent-links', {
        method: 'POST',
        body: JSON.stringify({
          parentUserId: Number(linkParentUserId),
          studentUserId: Number(linkStudentUserId),
          relationship: linkRelation,
        }),
      });
      showToast('Parent & Student Linked!', 'success');
      setLinkParentUserId('');
      setLinkStudentUserId('');
      loadUsers();
    } catch (err: any) {
      showToast('Failed to link accounts', 'error', err.message);
    }
  };

  const handleUnlink = async (linkId: number) => {
    await apiFetch(`/api/admin/parent-links/${linkId}`, { method: 'DELETE' });
    showToast('Link removed', 'info');
    loadUsers();
  };

  const parentList = users.filter((u) => u.role === 'parent');
  const studentList = users.filter((u) => u.role === 'student');

  return (
    <div className="space-y-6">
      {/* Top Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white rounded-3xl border border-slate-200 p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'student', 'parent', 'chef', 'admin'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition ${
                roleFilter === r
                  ? 'bg-brs-navy text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {r === 'all' ? 'All Roles' : `${r}s`}
            </button>
          ))}

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold bg-white"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Deactivated</option>
          </select>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, ID, class..."
              className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brs-royal"
            />
          </div>

          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brs-navy hover:bg-brs-royal text-white font-semibold text-xs shadow-sm transition shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            Create User
          </button>
        </div>
      </div>

      {/* Quick Parent-Child Linker Bar */}
      <form
        onSubmit={handleCreateLink}
        className="bg-white rounded-3xl border border-slate-200 p-4 shadow-sm flex flex-col lg:flex-row lg:items-center gap-3"
      >
        <div className="flex items-center gap-2 text-xs font-bold text-brs-navy shrink-0">
          <Link2 className="w-4 h-4 text-amber-600" />
          Link Parent & Student:
        </div>
        <select
          value={linkParentUserId}
          onChange={(e) => setLinkParentUserId(e.target.value)}
          className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white"
          required
        >
          <option value="">Select Parent Account...</option>
          {parentList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName} (@{p.username})
            </option>
          ))}
        </select>
        <select
          value={linkStudentUserId}
          onChange={(e) => setLinkStudentUserId(e.target.value)}
          className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white"
          required
        >
          <option value="">Select Student Account...</option>
          {studentList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.fullName} ({s.className} • {s.studentCode})
            </option>
          ))}
        </select>
        <select
          value={linkRelation}
          onChange={(e) => setLinkRelation(e.target.value)}
          className="rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white"
        >
          <option value="Mother">Mother</option>
          <option value="Father">Father</option>
          <option value="Guardian">Guardian</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition shrink-0"
        >
          Save Link
        </button>
      </form>

      {/* Users Table */}
      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3.5">User & Username</th>
                <th className="px-4 py-3.5">Role</th>
                <th className="px-4 py-3.5">ID / Class / Dept</th>
                <th className="px-4 py-3.5">Family Links</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    Loading user directory...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    No matching users found.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-slate-900">{u.fullName}</div>
                      <div className="text-xs text-slate-500 font-mono">@{u.username}</div>
                      {u.email && <div className="text-[11px] text-slate-400">{u.email}</div>}
                    </td>
                    <td className="px-4 py-3.5">
                      <RolePill role={u.role} />
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-700">
                      {u.role === 'student' && (
                        <>
                          <div className="font-semibold">{u.className}</div>
                          <div className="font-mono text-slate-500">{u.studentCode}</div>
                        </>
                      )}
                      {u.role === 'chef' && (
                        <>
                          <div className="font-semibold">{u.station}</div>
                          <div className="font-mono text-slate-500">{u.staffCode}</div>
                        </>
                      )}
                      {u.role === 'parent' && <span>{u.phone || 'Parent Account'}</span>}
                      {u.role === 'admin' && <span>System Management</span>}
                    </td>
                    <td className="px-4 py-3.5 text-xs">
                      {u.linkedChildren?.map((lc: any) => (
                        <span
                          key={lc.linkId}
                          className="inline-flex items-center gap-1 bg-sky-50 border border-sky-200 text-sky-900 px-2 py-0.5 rounded-md mr-1 mb-1"
                        >
                          {lc.fullName} ({lc.className})
                          <button
                            onClick={() => handleUnlink(lc.linkId)}
                            className="text-rose-600 hover:text-rose-800"
                            title="Unlink"
                          >
                            <Unlink className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {u.linkedParents?.map((lp: any) => (
                        <span
                          key={lp.linkId}
                          className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-900 px-2 py-0.5 rounded-md mr-1 mb-1"
                        >
                          {lp.fullName} ({lp.relationship})
                        </span>
                      ))}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          u.isActive
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openEditModal(u)}
                          className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700"
                          title="Edit User"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleResetPassword(u)}
                          className="p-1.5 rounded-lg border border-slate-200 hover:bg-amber-50 text-amber-700"
                          title="Reset Password"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(u)}
                          className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700"
                          title={u.isActive ? 'Deactivate' : 'Activate'}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u)}
                          className="p-1.5 rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-600"
                          title="Delete Account"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit User Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-elevated border border-slate-200 my-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                {editingUser ? `Edit ${editingUser.fullName}` : 'Create New School Account'}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-3.5 text-xs sm:text-sm">
              {!editingUser && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Account Role *
                  </label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as UserRole)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white font-semibold"
                  >
                    <option value="student">Student</option>
                    <option value="parent">Parent</option>
                    <option value="chef">Chef / Kitchen Staff</option>
                    <option value="admin">Administrator</option>
                  </select>
                  {formRole === 'admin' && (
                    <p className="mt-1 text-xs text-amber-700">Administrators can manage users, orders, payments and settings. Grant access only to trusted staff.</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Username *
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono"
                    required
                  />
                </div>
              </div>

              {!editingUser && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Initial Password (min 8 chars) *
                  </label>
                  <input
                    type="password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                    required
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Contact Phone
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>

              {formRole === 'student' && (
                <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Class (e.g. Grade 5-A) *
                      </label>
                      <input
                        type="text"
                        value={className}
                        onChange={(e) => setClassName(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3 py-1.5 bg-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Student ID (Auto if blank)
                      </label>
                      <input
                        type="text"
                        value={studentCode}
                        onChange={(e) => setStudentCode(e.target.value)}
                        placeholder="BRS-STU-..."
                        className="w-full rounded-xl border border-slate-300 px-3 py-1.5 bg-white font-mono"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        School House
                      </label>
                      <input
                        type="text"
                        value={house}
                        onChange={(e) => setHouse(e.target.value)}
                        placeholder="Falcon House"
                        className="w-full rounded-xl border border-slate-300 px-3 py-1.5 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Allergies / Dietary
                      </label>
                      <input
                        type="text"
                        value={allergiesNotes}
                        onChange={(e) => setAllergiesNotes(e.target.value)}
                        placeholder="None"
                        className="w-full rounded-xl border border-slate-300 px-3 py-1.5 bg-white"
                      />
                    </div>
                  </div>
                  {!editingUser && parentList.length > 0 && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Link to Parent Account (Optional)
                      </label>
                      <select
                        value={linkedParentId}
                        onChange={(e) => setLinkedParentId(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3 py-1.5 bg-white"
                      >
                        <option value="">-- Link later or select parent --</option>
                        {parentList.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.fullName} (@{p.username})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {formRole === 'chef' && (
                <div className="grid grid-cols-2 gap-3 bg-slate-50 rounded-2xl p-3.5 border border-slate-200">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Kitchen Staff ID
                    </label>
                    <input
                      type="text"
                      value={staffCode}
                      onChange={(e) => setStaffCode(e.target.value)}
                      placeholder="BRS-CHF-..."
                      className="w-full rounded-xl border border-slate-300 px-3 py-1.5 bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Kitchen Station
                    </label>
                    <input
                      type="text"
                      value={station}
                      onChange={(e) => setStation(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-1.5 bg-white"
                    />
                  </div>
                </div>
              )}

              {formRole === 'parent' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Residential Address
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </div>
              )}

              <div className="pt-2 flex gap-2.5">
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-brs-navy hover:bg-brs-royal text-white font-semibold transition"
                >
                  {editingUser ? 'Save Changes' : 'Create Account'}
                </button>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-semibold"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
