'use client';

import React, { useState, useEffect } from 'react';
import {
  Settings,
  Shield,
  Key,
  Database,
  Cpu,
  CheckCircle2,
  RefreshCw,
  Loader2,
  AlertCircle
} from 'lucide-react';

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>({
    ai_provider: 'built_in',
    gemini_api_key: '',
    gemini_model: 'gemini-3.5-flash-lite',
    openai_api_key: '',
    openai_model: 'gpt-4o',
    anthropic_api_key: '',
    anthropic_model: 'claude-3-5-sonnet-20241022',
    max_upload_size_mb: '100',
    ocr_confidence_threshold: '75'
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [resettingDemo, setResettingDemo] = useState(false);
  const [demoSuccess, setDemoSuccess] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      try {
        setLoading(true);
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          setSettings((prev: any) => ({ ...prev, ...(data.settings || {}) }));
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleResetDemo = async () => {
    if (!confirm('This will refresh the 10 Representative Clinical Test Cases and sample textbooks (your uploaded PDFs will remain preserved). Proceed?')) return;

    try {
      setResettingDemo(true);
      const res = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceReset: true })
      });
      if (res.ok) {
        setDemoSuccess(true);
        setTimeout(() => setDemoSuccess(false), 4000);
      }
    } catch (err) {
      console.error('Demo reset failed:', err);
    } finally {
      setResettingDemo(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
          <Settings className="h-6 w-6 text-teal-600" />
          <span>System Settings & AI Configuration</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure AI reasoning providers, API credentials, OCR verification parameters, and storage thresholds.
        </p>
      </div>

      {loading ? (
        <div className="p-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-teal-600 mx-auto mb-2" />
          <p className="text-xs text-slate-500">Loading system settings...</p>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          {/* AI PROVIDER CONFIGURATION */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-5">
            <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
              <Cpu className="h-5 w-5 text-teal-600" />
              <span>AI Engine & Medical Reasoning Configuration</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Active AI Reasoning Provider
              </label>
              <select
                value={settings.ai_provider}
                onChange={(e) => setSettings({ ...settings, ai_provider: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
              >
                <option value="built_in">Built-in Deterministic Medical Auditor (Zero External API required)</option>
                <option value="gemini">Google Gemini API (Official Developer API)</option>
                <option value="openai">OpenAI API (GPT-4o)</option>
                <option value="anthropic">Anthropic API (Claude 3.5 Sonnet)</option>
              </select>
            </div>

            {/* Gemini settings */}
            {settings.ai_provider === 'gemini' && (
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
                <div className="text-xs font-bold text-slate-800">Google Gemini API Credentials</div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Gemini API Key</label>
                  <input
                    type="password"
                    value={settings.gemini_api_key || ''}
                    onChange={(e) => setSettings({ ...settings, gemini_api_key: e.target.value })}
                    placeholder={settings.has_gemini_api_key ? '•••••••••••••••• (Key Configured)' : 'Enter GEMINI_API_KEY'}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Model Name</label>
                  <input
                    type="text"
                    value={settings.gemini_model || 'gemini-3.5-flash-lite'}
                    onChange={(e) => setSettings({ ...settings, gemini_model: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none bg-white font-mono"
                  />
                </div>
              </div>
            )}

            {/* OpenAI settings */}
            {settings.ai_provider === 'openai' && (
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
                <div className="text-xs font-bold text-slate-800">OpenAI API Credentials</div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">OpenAI API Key</label>
                  <input
                    type="password"
                    value={settings.openai_api_key || ''}
                    onChange={(e) => setSettings({ ...settings, openai_api_key: e.target.value })}
                    placeholder={settings.has_openai_api_key ? '•••••••••••••••• (Key Configured)' : 'sk-...'}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Model Name</label>
                  <input
                    type="text"
                    value={settings.openai_model || 'gpt-4o'}
                    onChange={(e) => setSettings({ ...settings, openai_model: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none bg-white font-mono"
                  />
                </div>
              </div>
            )}

            {/* Anthropic settings */}
            {settings.ai_provider === 'anthropic' && (
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
                <div className="text-xs font-bold text-slate-800">Anthropic Claude API Credentials</div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Anthropic API Key</label>
                  <input
                    type="password"
                    value={settings.anthropic_api_key || ''}
                    onChange={(e) => setSettings({ ...settings, anthropic_api_key: e.target.value })}
                    placeholder={settings.has_anthropic_api_key ? '•••••••••••••••• (Key Configured)' : 'sk-ant-...'}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Model Name</label>
                  <input
                    type="text"
                    value={settings.anthropic_model || 'claude-3-5-sonnet-20241022'}
                    onChange={(e) => setSettings({ ...settings, anthropic_model: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none bg-white font-mono"
                  />
                </div>
              </div>
            )}
          </div>

          {/* OCR & PROCESSING THRESHOLDS */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
              <Shield className="h-5 w-5 text-teal-600" />
              <span>OCR & Ingestion Parameters</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Maximum PDF Upload Limit (MB)
                </label>
                <input
                  type="number"
                  value={settings.max_upload_size_mb || '100'}
                  onChange={(e) => setSettings({ ...settings, max_upload_size_mb: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  OCR Flag Threshold Confidence (%)
                </label>
                <input
                  type="number"
                  value={settings.ocr_confidence_threshold || '75'}
                  onChange={(e) => setSettings({ ...settings, ocr_confidence_threshold: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* REPRESENTATIVE TEST SUITE DATASET */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-3">
            <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
              <Database className="h-5 w-5 text-teal-600" />
              <span>Representative Clinical Test Suite (10 Clinical Scenarios)</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Populates all 10 representative test cases required by the specification: correct answer, incorrect key, multiple correct options, no correct options, ambiguous question, stem wording error, scanned PDF requiring OCR, appearing in multiple books, conflicting references, and insufficient evidence.
            </p>

            <div className="pt-2">
              <button
                type="button"
                disabled={resettingDemo}
                onClick={handleResetDemo}
                className="inline-flex items-center space-x-2 text-xs font-semibold px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg transition disabled:opacity-50"
              >
                {resettingDemo ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Seeding Test Data...</span>
                  </>
                ) : demoSuccess ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    <span>10 Representative Cases Ready!</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Re-seed 10 Clinical Test Scenarios</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* SAVE BUTTON */}
          <div className="flex items-center justify-between pt-2">
            <div>
              {saveSuccess && (
                <span className="text-xs font-semibold text-emerald-600 flex items-center space-x-1">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Settings saved successfully!</span>
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center space-x-2 text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white px-5 py-2.5 rounded-lg shadow-sm transition disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
