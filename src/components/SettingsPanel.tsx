import { useMemo, useState } from 'react';
import type { Settings } from '../lib/types';
import { listModels, type GeminiModelInfo } from '../lib/gemini';
import { Modal } from './Modal';
import { IconSparkles, IconSpeaker, IconCheck } from './Icons';
import type { useSpeech } from '../hooks/useSpeech';

const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro',
];

type Speech = ReturnType<typeof useSpeech>;

export function SettingsPanel({
  settings,
  update,
  speech,
  notify,
  onClose,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  speech: Speech;
  notify: (msg: string, type?: 'info' | 'error' | 'success') => void;
  onClose: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [checking, setChecking] = useState(false);
  const [fetched, setFetched] = useState<GeminiModelInfo[] | null>(null);

  const modelOptions = useMemo(() => {
    const names = new Set<string>();
    if (fetched) fetched.forEach((m) => names.add(m.name));
    else FALLBACK_MODELS.forEach((m) => names.add(m));
    if (settings.model) names.add(settings.model);
    return Array.from(names);
  }, [fetched, settings.model]);

  const checkKey = async () => {
    if (!settings.apiKey.trim()) {
      notify('Bitte zuerst einen API-Schlüssel eingeben.', 'error');
      return;
    }
    setChecking(true);
    try {
      const models = await listModels(settings.apiKey.trim());
      setFetched(models);
      notify(`Schlüssel gültig – ${models.length} Modelle gefunden.`, 'success');
      if (!models.find((m) => m.name === settings.model) && models.length) {
        const preferred =
          models.find((m) => /2\.0-flash$/.test(m.name)) ||
          models.find((m) => /flash/.test(m.name)) ||
          models[0];
        update({ model: preferred.name });
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Prüfung fehlgeschlagen.', 'error');
    } finally {
      setChecking(false);
    }
  };

  const germanVoices = useMemo(() => {
    const v = [...speech.voices];
    v.sort((a, b) => {
      const ad = a.lang.toLowerCase().startsWith('de') ? 0 : 1;
      const bd = b.lang.toLowerCase().startsWith('de') ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return a.name.localeCompare(b.name);
    });
    return v;
  }, [speech.voices]);

  const testVoice = () => {
    speech.speak(['Dies ist eine Hörprobe deiner Vorlesestimme.'], {
      voiceURI: settings.voiceURI || undefined,
      rate: settings.ttsRate,
      pitch: settings.ttsPitch,
      lang: 'de-DE',
    });
  };

  return (
    <Modal title="Einstellungen" onClose={onClose}>
      {/* KI / Gemini */}
      <div className="group">
        <div className="group-title">Google Gemini (KI für die Kapitel)</div>
        <div className="field">
          <label htmlFor="apikey">API-Schlüssel</label>
          <div className="input-row">
            <input
              id="apikey"
              className="input"
              type={showKey ? 'text' : 'password'}
              placeholder="AIza…"
              autoComplete="off"
              spellCheck={false}
              value={settings.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
            />
            <button className="btn small" onClick={() => setShowKey((s) => !s)} type="button">
              {showKey ? 'Verbergen' : 'Zeigen'}
            </button>
          </div>
          <span className="hint">
            Der Schlüssel bleibt nur in diesem Browser gespeichert. Kostenlos erstellen unter{' '}
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
              aistudio.google.com/app/apikey
            </a>
            .
          </span>
        </div>

        <div className="field">
          <label htmlFor="model">Modell</label>
          <div className="input-row">
            <select
              id="model"
              className="select"
              value={settings.model}
              onChange={(e) => update({ model: e.target.value })}
            >
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button className="btn small" onClick={checkKey} disabled={checking} type="button">
              {checking ? <span className="spinner" /> : <IconCheck width={16} height={16} />}
              {checking ? 'Prüfe…' : 'Prüfen'}
            </button>
          </div>
          <span className="hint">
            „Flash“-Modelle sind schnell und günstig und für die Kapitel-Einteilung bestens
            geeignet.
          </span>
        </div>
      </div>

      {/* Vorlesen */}
      <div className="group">
        <div className="group-title">Vorlesen (Sprachausgabe)</div>
        {!speech.supported && (
          <span className="hint">Dieser Browser unterstützt keine Sprachausgabe.</span>
        )}
        <div className="row">
          <div className="row-label">
            <b>Laut vorlesen</b>
            <span>Text in beiden Lesemodi hörbar machen</span>
          </div>
          <Switch
            checked={settings.ttsEnabled}
            onChange={(v) => update({ ttsEnabled: v })}
            disabled={!speech.supported}
          />
        </div>
        <div className="field">
          <label htmlFor="voice">Stimme</label>
          <div className="input-row">
            <select
              id="voice"
              className="select"
              value={settings.voiceURI}
              onChange={(e) => update({ voiceURI: e.target.value })}
              disabled={!speech.supported}
            >
              <option value="">Standardstimme des Geräts</option>
              {germanVoices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
            <button
              className="btn small"
              onClick={testVoice}
              type="button"
              disabled={!speech.supported}
            >
              <IconSpeaker width={16} height={16} /> Test
            </button>
          </div>
        </div>
        <Slider
          label="Tempo"
          min={0.5}
          max={2}
          step={0.05}
          value={settings.ttsRate}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => update({ ttsRate: v })}
        />
        <Slider
          label="Tonhöhe"
          min={0.5}
          max={1.6}
          step={0.05}
          value={settings.ttsPitch}
          format={(v) => v.toFixed(2)}
          onChange={(v) => update({ ttsPitch: v })}
        />
      </div>

      {/* Fokus-Modus */}
      <div className="group">
        <div className="group-title">Fokus-Modus (Wort für Wort)</div>
        <Slider
          label="Geschwindigkeit"
          min={100}
          max={1000}
          step={10}
          value={settings.wpm}
          format={(v) => `${v} WpM`}
          onChange={(v) => update({ wpm: v })}
        />
        <div className="row">
          <div className="row-label">
            <b>Fixpunkt hervorheben</b>
            <span>Farbiger Buchstabe als Lese-Anker (ORP)</span>
          </div>
          <Switch checked={settings.showOrp} onChange={(v) => update({ showOrp: v })} />
        </div>
        <div className="row">
          <div className="row-label">
            <b>Kontext zeigen</b>
            <span>Umliegende Wörter blass einblenden</span>
          </div>
          <Switch checked={settings.showContext} onChange={(v) => update({ showContext: v })} />
        </div>
        <div className="row">
          <div className="row-label">
            <b>Pause bei langen Wörtern</b>
            <span>Längere Wörter etwas länger anzeigen</span>
          </div>
          <Switch checked={settings.longWordPause} onChange={(v) => update({ longWordPause: v })} />
        </div>
      </div>

      {/* Darstellung */}
      <div className="group">
        <div className="group-title">Darstellung</div>
        <div className="field">
          <label>Farbstimmung</label>
          <div className="input-row" role="group">
            {(['warm', 'sepia', 'nacht'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`btn small ${settings.theme === t ? 'primary' : ''}`}
                style={{ flex: 1, textTransform: 'capitalize' }}
                onClick={() => update({ theme: t })}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <Slider
          label="Schriftgröße (Buch)"
          min={0.8}
          max={1.8}
          step={0.05}
          value={settings.fontScale}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={(v) => update({ fontScale: v })}
        />
        <Slider
          label="Zeilenabstand (Buch)"
          min={1.4}
          max={2.2}
          step={0.05}
          value={settings.lineHeight}
          format={(v) => v.toFixed(2)}
          onChange={(v) => update({ lineHeight: v })}
        />
      </div>

      <p className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <IconSparkles width={16} height={16} /> Tipp: Mit hinterlegtem Schlüssel kannst du die
        Kapitel jederzeit neu durch die KI gliedern lassen.
      </p>
    </Modal>
  );
}

function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="track" />
      <span className="thumb" />
    </label>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="slider-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <span className="val">{format(value)}</span>
      </div>
    </div>
  );
}
