import React, { useState, useMemo } from 'react';
import { X, TrendingUp, DollarSign, Clock, Phone, Users } from 'lucide-react';

const ROICalculator = ({ onClose }) => {
  const [inputs, setInputs] = useState({
    callsPerDay: 15,
    missedPctManual: 30,
    avgJobValue: 350,
    receptionistCost: 3200,
    hoursPerDay: 8,
  });

  const set = (key, raw) => {
    const v = raw === '' ? '' : Math.max(0, Number(raw));
    setInputs(prev => ({ ...prev, [key]: v }));
  };

  const results = useMemo(() => {
    const { callsPerDay, missedPctManual, avgJobValue, receptionistCost, hoursPerDay } = inputs;
    const monthlyCallsTotal = callsPerDay * 30;

    // Missed calls recovered by AI (24/7 coverage + no hold times)
    const missedCallsPerMonth = Math.round(monthlyCallsTotal * (missedPctManual / 100));
    // Assume ~35% of recovered missed calls convert to jobs
    const conversionRate = 0.35;
    const recoveredJobs = Math.round(missedCallsPerMonth * conversionRate);
    const recoveredRevenue = recoveredJobs * avgJobValue;

    // After-hours calls captured (AI works 24/7 vs receptionist works N hours)
    const afterHoursPct = Math.max(0, ((24 - hoursPerDay) / 24));
    const afterHoursCalls = Math.round(monthlyCallsTotal * afterHoursPct);

    // Cost comparison
    const aiCostStandard = 495;
    const aiCostPro = 695;

    const monthlySavingsStandard = receptionistCost - aiCostStandard;
    const monthlySavingsPro = receptionistCost - aiCostPro;

    // Total value = savings + recovered revenue
    const totalValueStandard = monthlySavingsStandard + recoveredRevenue;
    const totalValuePro = monthlySavingsPro + recoveredRevenue;

    const roiStandard = aiCostStandard > 0 ? Math.round((totalValueStandard / aiCostStandard) * 100) : 0;
    const roiPro = aiCostPro > 0 ? Math.round((totalValuePro / aiCostPro) * 100) : 0;

    // Annual projections
    const annualValueStandard = totalValueStandard * 12;
    const annualValuePro = totalValuePro * 12;

    return {
      monthlyCallsTotal,
      missedCallsPerMonth,
      recoveredJobs,
      recoveredRevenue,
      afterHoursCalls,
      monthlySavingsStandard,
      monthlySavingsPro,
      totalValueStandard,
      totalValuePro,
      roiStandard,
      roiPro,
      annualValueStandard,
      annualValuePro,
    };
  }, [inputs]);

  const fmt = (n) => n.toLocaleString('en-US');
  const fmtDollar = (n) => '$' + n.toLocaleString('en-US');

  const InputField = ({ label, icon: Icon, field, prefix, suffix }) => (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{prefix}</span>}
        <input
          type="number"
          value={inputs[field]}
          onChange={e => set(field, e.target.value)}
          className={`w-full bg-gray-750 border border-gray-600 rounded-lg py-2.5 text-white text-sm focus:border-blue-500 focus:outline-none ${prefix ? 'pl-7 pr-3' : suffix ? 'pl-3 pr-8' : 'px-3'}`}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{suffix}</span>}
      </div>
    </div>
  );

  const ResultCard = ({ label, value, sub, color = 'text-white' }) => (
    <div className="bg-gray-750 rounded-lg p-3 text-center">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-gray-400 text-xs mt-0.5">{label}</p>
      {sub && <p className="text-gray-500 text-xs">{sub}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-y-auto py-6 px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-600">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">ROI Calculator</h2>
              <p className="text-xs text-gray-400">See what an AI receptionist saves you</p>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-lg">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          )}
        </div>

        <div className="p-5 space-y-6">
          {/* Inputs */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Your Business</h3>
            <div className="grid grid-cols-2 gap-3">
              <InputField label="Calls per day" field="callsPerDay" />
              <InputField label="Missed call %" field="missedPctManual" suffix="%" />
              <InputField label="Avg job value" field="avgJobValue" prefix="$" />
              <InputField label="Receptionist cost/mo" field="receptionistCost" prefix="$" />
              <InputField label="Receptionist hours/day" field="hoursPerDay" suffix="hrs" />
            </div>
          </div>

          {/* Key metrics */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">What You're Losing Today</h3>
            <div className="grid grid-cols-3 gap-3">
              <ResultCard
                label="Missed calls/mo"
                value={fmt(results.missedCallsPerMonth)}
                color="text-red-400"
              />
              <ResultCard
                label="Lost jobs/mo"
                value={fmt(results.recoveredJobs)}
                sub={`at ${Math.round(35)}% conversion`}
                color="text-red-400"
              />
              <ResultCard
                label="Lost revenue/mo"
                value={fmtDollar(results.recoveredRevenue)}
                color="text-red-400"
              />
            </div>
          </div>

          {/* After-hours insight */}
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 flex items-start gap-3">
            <Phone className="w-5 h-5 text-yellow-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-white font-medium">
                ~{fmt(results.afterHoursCalls)} calls/mo come in after hours
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Your receptionist covers {inputs.hoursPerDay}hrs/day. AI covers all 24 — nights, weekends, and holidays.
              </p>
            </div>
          </div>

          {/* Plan comparison */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">With Reliant Support AI</h3>
            <div className="grid grid-cols-2 gap-3">
              {/* Standard */}
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <span className="px-2 py-0.5 bg-cyan-900 text-cyan-300 rounded text-xs font-medium">Standard</span>
                  <span className="text-gray-400 text-sm">$495/mo</span>
                </div>
                <p className="text-xs text-gray-500 mb-3">1,000 minutes included</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Salary savings</span>
                    <span className={results.monthlySavingsStandard >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {fmtDollar(results.monthlySavingsStandard)}/mo
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Recovered revenue</span>
                    <span className="text-green-400">+{fmtDollar(results.recoveredRevenue)}/mo</span>
                  </div>
                  <div className="border-t border-gray-700 pt-2 flex justify-between text-sm font-semibold">
                    <span className="text-gray-300">Total value</span>
                    <span className="text-green-400">{fmtDollar(results.totalValueStandard)}/mo</span>
                  </div>
                </div>
                <div className="mt-3 text-center">
                  <p className="text-2xl font-bold text-green-400">{results.roiStandard}%</p>
                  <p className="text-xs text-gray-500">return on investment</p>
                </div>
              </div>

              {/* Pro */}
              <div className="bg-gray-800 rounded-lg p-4 border border-blue-600/50">
                <div className="flex items-center justify-between mb-3">
                  <span className="px-2 py-0.5 bg-amber-900 text-amber-300 rounded text-xs font-medium">Pro</span>
                  <span className="text-gray-400 text-sm">$695/mo</span>
                </div>
                <p className="text-xs text-gray-500 mb-3">2,000 minutes included</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Salary savings</span>
                    <span className={results.monthlySavingsPro >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {fmtDollar(results.monthlySavingsPro)}/mo
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Recovered revenue</span>
                    <span className="text-green-400">+{fmtDollar(results.recoveredRevenue)}/mo</span>
                  </div>
                  <div className="border-t border-gray-700 pt-2 flex justify-between text-sm font-semibold">
                    <span className="text-gray-300">Total value</span>
                    <span className="text-green-400">{fmtDollar(results.totalValuePro)}/mo</span>
                  </div>
                </div>
                <div className="mt-3 text-center">
                  <p className="text-2xl font-bold text-green-400">{results.roiPro}%</p>
                  <p className="text-xs text-gray-500">return on investment</p>
                </div>
              </div>
            </div>
          </div>

          {/* Annual projection */}
          <div className="bg-gradient-to-r from-green-900/30 to-blue-900/30 rounded-lg p-4 border border-green-800/50">
            <h3 className="text-sm font-semibold text-green-400 mb-2">Annual Projection</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-400">Standard Plan — 1 year</p>
                <p className="text-xl font-bold text-white">{fmtDollar(results.annualValueStandard)}</p>
                <p className="text-xs text-gray-500">total value generated</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Pro Plan — 1 year</p>
                <p className="text-xl font-bold text-white">{fmtDollar(results.annualValuePro)}</p>
                <p className="text-xs text-gray-500">total value generated</p>
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-600 text-center">
            Estimates based on a 35% conversion rate for recovered missed calls. Actual results may vary.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ROICalculator;
