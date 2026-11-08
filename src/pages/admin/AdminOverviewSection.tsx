import React, { useState } from 'react';
import {
  Users,
  GraduationCap,
  ChefHat,
  BookOpen,
  ShoppingBag,
  Clock,
  CheckCircle2,
  Banknote,
  TrendingUp,
  Award,
} from 'lucide-react';

interface AdminOverviewProps {
  data: any;
}

export const AdminOverviewSection: React.FC<AdminOverviewProps> = ({ data }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data) {
    return (
      <div className="py-14 text-center text-slate-500 text-sm">
        Loading Bright Riders executive canteen overview...
      </div>
    );
  }

  const dailySeries: Array<{ date: string; revenueAed: number; ordersCount: number }> =
    data.charts?.dailySeries || [];
  const popularItems: Array<{
    name: string;
    categoryName: string;
    quantitySold: number;
    revenueAed: number;
    formattedRevenue: string;
  }> = data.charts?.popularItems || [];
  const classBreakdown: Array<{ className: string; ordersCount: number; revenueAed: number }> =
    data.charts?.classBreakdown || [];

  const maxRev = Math.max(50, ...dailySeries.map((d) => d.revenueAed));
  const chartW = 640;
  const chartH = 190;
  const padX = 28;
  const padY = 20;

  const points = dailySeries.map((pt, idx) => {
    const x =
      padX + (idx / Math.max(1, dailySeries.length - 1)) * (chartW - padX * 2);
    const y =
      chartH - padY - (pt.revenueAed / maxRev) * (chartH - padY * 2);
    return { x, y, ...pt };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${
          chartH - padY
        } L ${points[0].x.toFixed(1)} ${chartH - padY} Z`
      : '';

  const maxPopQty = Math.max(1, ...popularItems.map((i) => i.quantitySold));

  return (
    <div className="space-y-6">
      {/* Top Revenue & Order KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-brs-navy to-brs-royal rounded-3xl p-5 text-white shadow-soft">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
              Total Canteen Sales
            </span>
            <Banknote className="w-5 h-5 text-amber-300" />
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold mt-2">
            {data.revenue.formattedTotalSales}
          </p>
          <p className="text-xs text-slate-300 mt-1">
            Today: <strong>{data.revenue.formattedDailyRevenue}</strong> • 7-Day:{' '}
            <strong>{data.revenue.formattedWeeklyRevenue}</strong>
          </p>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total Orders
            </span>
            <ShoppingBag className="w-5 h-5 text-brs-royal" />
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-2">
            {data.orders.total}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {data.orders.cancelled} cancelled • {data.revenue.formattedMonthlyRevenue} (30d)
          </p>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Pending / Active Queue
            </span>
            <Clock className="w-5 h-5 text-amber-600" />
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-amber-600 mt-2">
            {data.orders.pending}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Awaiting preparation or student pickup
          </p>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Completed Collections
            </span>
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-emerald-700 mt-2">
            {data.orders.completed}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Verified via QR Scanner & Chef KDS
          </p>
        </div>
      </div>

      {/* User Role Breakdown Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Users', val: data.users.total, icon: Users, cls: 'text-brs-navy' },
          { label: 'Students', val: data.users.students, icon: GraduationCap, cls: 'text-emerald-700' },
          { label: 'Parents', val: data.users.parents, icon: Users, cls: 'text-sky-700' },
          { label: 'Teachers', val: data.users.teachers, icon: BookOpen, cls: 'text-violet-700' },
          { label: 'Chefs', val: data.users.chefs, icon: ChefHat, cls: 'text-amber-700' },
        ].map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.label}
              className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between"
            >
              <div>
                <p className="text-xs font-semibold text-slate-500">{c.label}</p>
                <p className={`text-xl font-extrabold mt-0.5 ${c.cls}`}>{c.val}</p>
              </div>
              <Icon className={`w-5 h-5 opacity-70 ${c.cls}`} />
            </div>
          );
        })}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* 14-Day Revenue Area Chart */}
        <div className="lg:col-span-3 bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-brs-royal" />
                14-Day Canteen Revenue Trend (AED)
              </h3>
              <p className="text-xs text-slate-500">
                Daily confirmed digital sales across Bright Riders School
              </p>
            </div>
            {hoveredIdx !== null && points[hoveredIdx] && (
              <div className="text-right bg-slate-100 px-3 py-1 rounded-xl text-xs">
                <span className="font-semibold text-slate-700">{points[hoveredIdx].date}: </span>
                <strong className="text-brs-navy">
                  AED {points[hoveredIdx].revenueAed.toFixed(2)}
                </strong>{' '}
                ({points[hoveredIdx].ordersCount} orders)
              </div>
            )}
          </div>

          <div className="w-full overflow-x-auto">
            <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-48 overflow-visible">
              <defs>
                <linearGradient id="brsRevGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#163A5F" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#163A5F" stopOpacity="0.01" />
                </linearGradient>
              </defs>

              {[0, 0.5, 1].map((t, i) => {
                const y = chartH - padY - t * (chartH - padY * 2);
                return (
                  <g key={i}>
                    <line
                      x1={padX}
                      x2={chartW - padX}
                      y1={y}
                      y2={y}
                      stroke="#E2E8F0"
                      strokeDasharray="4 4"
                    />
                  </g>
                );
              })}

              {areaPath && <path d={areaPath} fill="url(#brsRevGrad)" />}
              {linePath && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="#0F2942"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {points.map((pt, i) => (
                <g key={pt.date}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={hoveredIdx === i ? 5.5 : 3.5}
                    fill={hoveredIdx === i ? '#D97706' : '#0F2942'}
                    stroke="#FFFFFF"
                    strokeWidth="2"
                    className="cursor-pointer transition-all"
                    onMouseEnter={() => setHoveredIdx(i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                  />
                  {i % 3 === 0 && (
                    <text
                      x={pt.x}
                      y={chartH - 3}
                      textAnchor="middle"
                      className="fill-slate-400 text-[10px]"
                    >
                      {pt.date.slice(5)}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
        </div>

        {/* Most Popular Food Items */}
        <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
          <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-1">
            <Award className="w-4 h-4 text-amber-600" />
            Most Popular Food Items
          </h3>
          <p className="text-xs text-slate-500 mb-4">Ranked by total portions ordered</p>

          {popularItems.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              Popular item rankings will populate once orders are placed.
            </div>
          ) : (
            <div className="space-y-3">
              {popularItems.map((item) => (
                <div key={item.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 truncate pr-2">{item.name}</span>
                    <span className="text-slate-600 shrink-0">
                      <strong>{item.quantitySold}</strong> sold • {item.formattedRevenue}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brs-navy to-amber-500"
                      style={{
                        width: `${Math.max(8, (item.quantitySold / maxPopQty) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Class-Wise Orders Snapshot */}
      {classBreakdown.length > 0 && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
          <h3 className="font-bold text-slate-900 mb-3 text-sm">Class-Wise Canteen Participation</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {classBreakdown.map((cb) => (
              <div
                key={cb.className}
                className="rounded-2xl bg-slate-50 border border-slate-200/80 p-3.5"
              >
                <p className="text-xs font-bold text-brs-navy">{cb.className}</p>
                <p className="text-lg font-extrabold text-slate-900 mt-0.5">
                  {cb.ordersCount} orders
                </p>
                <p className="text-[11px] text-slate-500">AED {cb.revenueAed.toFixed(2)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
