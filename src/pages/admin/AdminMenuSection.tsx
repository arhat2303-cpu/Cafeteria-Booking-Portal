import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Edit3,
  Trash2,
  Upload,
  Calendar,
  Eye,
  EyeOff,
  FolderPlus,
  X,
  Settings2,
} from 'lucide-react';
import { apiFetch, uploadFoodImage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import type { FoodCategory, MenuItem } from '@/types';
import { FoodIllustrationPlaceholder } from '@/components/BrandCrest';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const AdminMenuSection: React.FC = () => {
  const { showToast } = useToast();
  const [categories, setCategories] = useState<FoodCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [selectedCat, setSelectedCat] = useState<number | 'all'>('all');
  const [teacherOrderingEnabled, setTeacherOrderingEnabled] = useState(true);

  // Category Form
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');

  // Add/Edit Item Modal
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [itemCategoryId, setItemCategoryId] = useState<number>(0);
  const [itemName, setItemName] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemPriceAed, setItemPriceAed] = useState('');
  const [itemImageUrl, setItemImageUrl] = useState('');
  const [itemIsVeg, setItemIsVeg] = useState(false);
  const [itemCalories, setItemCalories] = useState('');
  const [itemAllergens, setItemAllergens] = useState('');
  const [uploadingImg, setUploadingImg] = useState(false);

  // Schedule Modal
  const [scheduleItem, setScheduleItem] = useState<MenuItem | null>(null);
  const [schedMode, setSchedMode] = useState<'date' | 'weekday'>('date');
  const [schedDate, setSchedDate] = useState('');
  const [schedWeekday, setSchedWeekday] = useState('1');
  const [schedAvailable, setSchedAvailable] = useState(true);
  const [schedNote, setSchedNote] = useState('');

  const loadMenuAndSettings = useCallback(async () => {
    try {
      const [menuRes, setRes] = await Promise.all([
        apiFetch<{ categories: FoodCategory[]; items: MenuItem[] }>('/api/menu'),
        apiFetch<{ settings: any }>('/api/admin/settings'),
      ]);
      setCategories(menuRes.categories);
      setItems(menuRes.items);
      setTeacherOrderingEnabled(setRes.settings.teacherOrderingEnabled !== false);
      if (menuRes.categories.length > 0 && !itemCategoryId) {
        setItemCategoryId(menuRes.categories[0].id);
      }
    } catch (err: any) {
      showToast('Failed to load menu', 'error', err.message);
    }
  }, [itemCategoryId, showToast]);

  useEffect(() => {
    loadMenuAndSettings();
  }, [loadMenuAndSettings]);

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;
    try {
      const created = await apiFetch<{ id: number }>('/api/menu/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: catName.trim(),
          description: catDesc.trim() || undefined,
          displayOrder: categories.length,
        }),
      });
      setCatName('');
      setCatDesc('');
      setItemCategoryId(created.id);
      showToast('Category created', 'success');
      loadMenuAndSettings();
    } catch (err: any) {
      showToast('Failed to create category', 'error', err.message);
    }
  };

  const handleDeleteCategory = async (cat: FoodCategory) => {
    if (!window.confirm(`Delete category "${cat.name}"?`)) return;
    try {
      await apiFetch(`/api/menu/categories/${cat.id}`, { method: 'DELETE' });
      showToast('Category deleted', 'info');
      loadMenuAndSettings();
    } catch (err: any) {
      showToast('Cannot delete category', 'error', err.message);
    }
  };

  const openCreateItem = () => {
    if (categories.length === 0) {
      showToast('Create a food category first', 'info');
      return;
    }
    setEditingItem(null);
    setItemCategoryId(categories[0].id);
    setItemName('');
    setItemDesc('');
    setItemPriceAed('');
    setItemImageUrl('');
    setItemIsVeg(false);
    setItemCalories('');
    setItemAllergens('');
    setItemModalOpen(true);
  };

  const openEditItem = (it: MenuItem) => {
    setEditingItem(it);
    setItemCategoryId(it.categoryId);
    setItemName(it.name);
    setItemDesc(it.description || '');
    setItemPriceAed(it.priceAed.toFixed(2));
    setItemImageUrl(it.imageUrl || '');
    setItemIsVeg(it.isVegetarian);
    setItemCalories(it.calories ? String(it.calories) : '');
    setItemAllergens(it.allergens || '');
    setItemModalOpen(true);
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImg(true);
    try {
      const res = await uploadFoodImage(file);
      setItemImageUrl(res.imageUrl);
      showToast('Food image uploaded!', 'success');
    } catch (err: any) {
      showToast('Upload failed', 'error', err.message);
    } finally {
      setUploadingImg(false);
      e.target.value = '';
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        categoryId: Number(itemCategoryId),
        name: itemName,
        description: itemDesc || null,
        priceAed: Number(itemPriceAed),
        imageUrl: itemImageUrl || null,
        isVegetarian: itemIsVeg,
        calories: itemCalories ? Number(itemCalories) : null,
        allergens: itemAllergens || null,
      };
      if (editingItem) {
        await apiFetch(`/api/menu/items/${editingItem.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showToast('Menu item updated', 'success');
      } else {
        await apiFetch('/api/menu/items', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Menu item added!', 'success');
      }
      setItemModalOpen(false);
      loadMenuAndSettings();
    } catch (err: any) {
      showToast('Failed to save item', 'error', err.message);
    }
  };

  const handleToggleItemAvailability = async (it: MenuItem) => {
    await apiFetch(`/api/menu/items/${it.id}/availability`, {
      method: 'PATCH',
      body: JSON.stringify({ isAvailable: !it.isAvailable }),
    });
    loadMenuAndSettings();
  };

  const handleDeleteItem = async (it: MenuItem) => {
    if (!window.confirm(`Delete "${it.name}" from menu?`)) return;
    await apiFetch(`/api/menu/items/${it.id}`, { method: 'DELETE' });
    showToast('Item deleted', 'info');
    loadMenuAndSettings();
  };

  const handleAddSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleItem) return;
    try {
      await apiFetch(`/api/menu/items/${scheduleItem.id}/schedules`, {
        method: 'POST',
        body: JSON.stringify({
          specificDate: schedMode === 'date' ? schedDate : undefined,
          dayOfWeek: schedMode === 'weekday' ? Number(schedWeekday) : undefined,
          isAvailable: schedAvailable,
          specialNote: schedNote || undefined,
        }),
      });
      setSchedNote('');
      showToast('Schedule saved', 'success');
      const updated = await apiFetch<{ items: MenuItem[] }>('/api/menu');
      setItems(updated.items);
      const fresh = updated.items.find((x) => x.id === scheduleItem.id) || null;
      setScheduleItem(fresh);
    } catch (err: any) {
      showToast('Failed to add schedule', 'error', err.message);
    }
  };

  const handleDeleteSchedule = async (scheduleId: number) => {
    await apiFetch(`/api/menu/schedules/${scheduleId}`, { method: 'DELETE' });
    const updated = await apiFetch<{ items: MenuItem[] }>('/api/menu');
    setItems(updated.items);
    if (scheduleItem) {
      setScheduleItem(updated.items.find((x) => x.id === scheduleItem.id) || null);
    }
  };

  const handleToggleTeacherOrdering = async (next: boolean) => {
    setTeacherOrderingEnabled(next);
    await apiFetch('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ teacherOrderingEnabled: next }),
    });
    showToast(
      next ? 'Teacher Ordering Enabled' : 'Teacher Ordering Disabled',
      'info',
      'Updated live across Teacher dashboards.'
    );
  };

  const visibleItems =
    selectedCat === 'all' ? items : items.filter((i) => i.categoryId === selectedCat);

  return (
    <div className="space-y-6">
      {/* Top Bar: Add Category + Add Food Item + Teacher Ordering Policy */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <form
          onSubmit={handleAddCategory}
          className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-4 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-brs-navy shrink-0">
            <FolderPlus className="w-4 h-4 text-amber-600" />
            New Category:
          </div>
          <input
            type="text"
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            placeholder="Category Name (e.g. Sandwiches, Juices)"
            className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs"
            required
          />
          <input
            type="text"
            value={catDesc}
            onChange={(e) => setCatDesc(e.target.value)}
            placeholder="Optional description"
            className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-brs-royal text-white font-semibold text-xs shrink-0"
          >
            Add Category
          </button>
        </form>

        <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Settings2 className="w-5 h-5 text-brs-royal shrink-0" />
            <div>
              <p className="text-xs font-bold text-slate-900">Teacher Ordering</p>
              <p className="text-[11px] text-slate-500">Allow teachers to place personal orders</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleToggleTeacherOrdering(!teacherOrderingEnabled)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition ${
              teacherOrderingEnabled
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-200 text-slate-700'
            }`}
          >
            {teacherOrderingEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>

      {/* Category Filter Pills + Add Item Action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedCat('all')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold ${
              selectedCat === 'all'
                ? 'bg-brs-navy text-white'
                : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            All Categories ({items.length})
          </button>
          {categories.map((c) => (
            <div
              key={c.id}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                selectedCat === c.id
                  ? 'bg-brs-navy text-white border-brs-navy'
                  : 'bg-white text-slate-700 border-slate-200'
              }`}
            >
              <button onClick={() => setSelectedCat(c.id)}>{c.name}</button>
              <button
                onClick={() => handleDeleteCategory(c)}
                className="opacity-60 hover:opacity-100"
                title="Delete empty category"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={openCreateItem}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs sm:text-sm shadow-sm transition"
        >
          <Plus className="w-4 h-4" />
          Add Food Item
        </button>
      </div>

      {/* Menu Items Grid */}
      {visibleItems.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-sm text-slate-500">
          No menu items in this view yet. Create categories and add official Bright Riders School
          canteen items above, or upload the official menu in chat for automatic extraction.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {visibleItems.map((it) => (
            <div
              key={it.id}
              className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="h-40 bg-slate-100 relative">
                  {it.imageUrl ? (
                    <img src={it.imageUrl} alt={it.name} className="w-full h-full object-cover" />
                  ) : (
                    <FoodIllustrationPlaceholder name={it.name} category={it.categoryName} />
                  )}
                  <span
                    className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      it.isAvailable
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-200'
                    }`}
                  >
                    {it.isAvailable ? 'Available' : 'Unavailable'}
                  </span>
                </div>

                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[11px] font-semibold text-amber-700 uppercase">
                        {it.categoryName}
                      </span>
                      <h3 className="font-bold text-slate-900 text-base leading-snug">{it.name}</h3>
                    </div>
                    <span className="font-extrabold text-sm text-brs-navy bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-xl shrink-0">
                      {it.formattedPrice}
                    </span>
                  </div>

                  {it.description && (
                    <p className="text-xs text-slate-500 mt-1.5 line-clamp-2">{it.description}</p>
                  )}

                  {it.schedules.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1">
                      {it.schedules.map((s) => (
                        <span
                          key={s.id}
                          className="text-[10px] px-2 py-0.5 rounded bg-sky-50 text-sky-900 border border-sky-200 font-medium"
                        >
                          {s.specificDate
                            ? `${s.specificDate}: ${s.isAvailable ? 'Served' : 'Off'}`
                            : `${WEEKDAYS[s.dayOfWeek || 0]}: ${s.isAvailable ? 'Served' : 'Off'}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="px-4 pb-4 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  onClick={() => handleToggleItemAvailability(it)}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold inline-flex items-center gap-1"
                >
                  {it.isAvailable ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" /> Hide
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" /> Enable
                    </>
                  )}
                </button>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setScheduleItem(it)}
                    className="p-2 rounded-xl border border-slate-200 hover:bg-sky-50 text-sky-700"
                    title="Schedule Dates / Weekdays"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => openEditItem(it)}
                    className="p-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700"
                    title="Edit Item & Price"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteItem(it)}
                    className="p-2 rounded-xl border border-rose-200 hover:bg-rose-50 text-rose-600"
                    title="Delete Item"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Food Item Modal */}
      {itemModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-elevated border border-slate-200 my-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                {editingItem ? `Edit "${editingItem.name}"` : 'Add Canteen Menu Item'}
              </h3>
              <button
                onClick={() => setItemModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-3.5 text-xs sm:text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Category *
                  </label>
                  <select
                    value={itemCategoryId}
                    onChange={(e) => setItemCategoryId(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white"
                    required
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Price (AED) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={itemPriceAed}
                    onChange={(e) => setItemPriceAed(e.target.value)}
                    placeholder="e.g. 12.50"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Exact Food Item Name *
                </label>
                <input
                  type="text"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={itemDesc}
                  onChange={(e) => setItemDesc(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Calories (kcal)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={itemCalories}
                    onChange={(e) => setItemCalories(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Allergens
                  </label>
                  <input
                    type="text"
                    value={itemAllergens}
                    onChange={(e) => setItemAllergens(e.target.value)}
                    placeholder="Dairy, Gluten..."
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={itemIsVeg}
                  onChange={(e) => setItemIsVeg(e.target.checked)}
                  className="rounded"
                />
                Vegetarian Item
              </label>

              {/* Image Upload or URL */}
              <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">Food Photo</span>
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-xs font-semibold">
                    <Upload className="w-3.5 h-3.5 text-brs-royal" />
                    {uploadingImg ? 'Uploading...' : 'Upload JPEG/PNG/WEBP'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                  </label>
                </div>
                <input
                  type="text"
                  value={itemImageUrl}
                  onChange={(e) => setItemImageUrl(e.target.value)}
                  placeholder="Or paste image path (/uploads/menu/...)"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                />
              </div>

              <div className="pt-2 flex gap-2.5">
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-brs-navy hover:bg-brs-royal text-white font-semibold transition"
                >
                  {editingItem ? 'Save Item Changes' : 'Add to Menu'}
                </button>
                <button
                  type="button"
                  onClick={() => setItemModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-semibold"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Menu Availability Schedule Modal */}
      {scheduleItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-elevated border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Schedule: {scheduleItem.name}
                </h3>
                <p className="text-xs text-slate-500">
                  Set specific dates or recurring school weekdays
                </p>
              </div>
              <button
                onClick={() => setScheduleItem(null)}
                className="p-1.5 rounded-full hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSchedule} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setSchedMode('date')}
                  className={`py-1.5 rounded-lg font-semibold ${
                    schedMode === 'date' ? 'bg-white shadow-sm text-brs-navy' : 'text-slate-600'
                  }`}
                >
                  Specific Date
                </button>
                <button
                  type="button"
                  onClick={() => setSchedMode('weekday')}
                  className={`py-1.5 rounded-lg font-semibold ${
                    schedMode === 'weekday' ? 'bg-white shadow-sm text-brs-navy' : 'text-slate-600'
                  }`}
                >
                  Day of Week
                </button>
              </div>

              {schedMode === 'date' ? (
                <input
                  type="date"
                  value={schedDate}
                  onChange={(e) => setSchedDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  required
                />
              ) : (
                <select
                  value={schedWeekday}
                  onChange={(e) => setSchedWeekday(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white"
                >
                  {WEEKDAYS.map((w, idx) => (
                    <option key={w} value={idx}>
                      {w}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={schedAvailable ? '1' : '0'}
                onChange={(e) => setSchedAvailable(e.target.value === '1')}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white"
              >
                <option value="1">Available on this schedule</option>
                <option value="0">Unavailable / Off Menu on this schedule</option>
              </select>

              <input
                type="text"
                value={schedNote}
                onChange={(e) => setSchedNote(e.target.value)}
                placeholder="Optional note (e.g. Thursday Special)"
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-brs-navy text-white font-semibold"
              >
                Add Schedule Rule
              </button>
            </form>

            {scheduleItem.schedules.length > 0 && (
              <div className="pt-3 border-t border-slate-200 space-y-2">
                <p className="text-xs font-bold text-slate-700">Active Rules</p>
                {scheduleItem.schedules.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2 text-xs"
                  >
                    <span>
                      {s.specificDate || WEEKDAYS[s.dayOfWeek || 0]} •{' '}
                      <strong>{s.isAvailable ? 'Served' : 'Unavailable'}</strong>
                      {s.specialNote ? ` (${s.specialNote})` : ''}
                    </span>
                    <button
                      onClick={() => handleDeleteSchedule(s.id)}
                      className="text-rose-600 hover:text-rose-800"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
