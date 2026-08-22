import { useState, useEffect, useCallback } from 'react';

interface WASession {
  supervisorId: number;
  supervisorName: string;
  role: string;
  sessionId: string;
  status: string;
  phone: string | null;
  hasQR: boolean;
  botEnabled: boolean;
  botFuente: string;
  botMarcas: string;
  gerenciaId?: number | null;
}

interface Usuario { id: number; name: string; role: string; }

interface Props {
  botApiUrl: string;
  title?: string;
}

const MARCAS = [
  { key: 'vw', label: 'VW' },
  { key: 'fiat', label: 'Fiat' },
  { key: 'peugeot', label: 'Peugeot' },
  { key: 'renault', label: 'Renault' },
];

const ROLE_BADGE: Record<string, { label: string; cls: string }> = {
  gerente:    { label: '🏢 Gerencia',   cls: 'bg-purple-100 text-purple-700' },
  supervisor: { label: '👔 Supervisor', cls: 'bg-blue-100 text-blue-700' },
  vendedor:   { label: '🧑‍💼 Vendedor',  cls: 'bg-emerald-100 text-emerald-700' },
};

export default function WhatsAppAdmin({ botApiUrl, title = 'WhatsApp Admin' }: Props) {
  const [pw, setPw] = useState('');
  const [authed, setAuthed] = useState(false);
  const [loginErr, setLoginErr] = useState(false);
  const [sessions, setSessions] = useState<WASession[]>([]);
  const [qrs, setQrs] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pollingIds, setPollingIds] = useState<Set<number>>(new Set());

  // Alta de número
  const [showAdd, setShowAdd] = useState(false);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [selUser, setSelUser] = useState<string>('');
  const [selFuente, setSelFuente] = useState<string>('');

  const FUENTES_OPTIONS = [
    '', 'Página Web', 'WhatsApp Masivo', 'Instagram', 'Facebook', 'Google Ads',
    'Referido', 'Llamada Entrante', 'Evento', 'Base Propia'
  ];
  const [fuenteEditing, setFuenteEditing] = useState<Record<number, boolean>>({});
  const [customFuente, setCustomFuente] = useState<Record<number, string>>({});
  const [gerSel, setGerSel] = useState<Record<number, string>>({});
  const [savingGer, setSavingGer] = useState<Record<number, boolean>>({});

  const hdrs = useCallback(() => ({ 'Content-Type': 'application/json', 'x-admin-password': pw }), [pw]);

  const doLogin = async () => {
    try {
      const res = await fetch(`${botApiUrl}/api/sessions`, { headers: { 'x-admin-password': pw } });
      if (res.ok) { setAuthed(true); setLoginErr(false); }
      else setLoginErr(true);
    } catch { setLoginErr(true); }
  };

  const load = useCallback(async () => {
    if (!authed) return;
    try {
      const res = await fetch(`${botApiUrl}/api/sessions`, { headers: hdrs() });
      if (!res.ok) { setError('Error conectando'); return; }
      const data = await res.json();
      setSessions(data.sessions || []);
      setError('');
      for (const s of (data.sessions || [])) {
        if (s.status === 'qr_ready') loadQR(s.supervisorId);
      }
    } catch { setError('No se pudo conectar al servidor WhatsApp'); }
    finally { setLoading(false); }
  }, [authed, botApiUrl, pw]);

  const loadUsuarios = useCallback(async () => {
    try {
      const res = await fetch(`${botApiUrl}/api/usuarios`);
      const data = await res.json();
      setUsuarios(data.usuarios || []);
    } catch {}
  }, [botApiUrl]);

  useEffect(() => {
    if (!authed) return;
    setLoading(true);
    load();
    loadUsuarios();
    const i = setInterval(load, 15000);
    return () => clearInterval(i);
  }, [authed, load, loadUsuarios]);

  const loadQR = async (id: number) => {
    try {
      const res = await fetch(`${botApiUrl}/api/sessions/${id}/qr`);
      const data = await res.json();
      if (data.status === 'qr_ready' && data.qr) setQrs(p => ({ ...p, [id]: data.qr }));
      else if (data.status === 'connected') { setQrs(p => { const n = { ...p }; delete n[id]; return n; }); load(); }
    } catch {}
  };

  const pollForQR = (id: number) => {
    setPollingIds(p => new Set(p).add(id));
    let a = 0;
    const interval = setInterval(async () => {
      a++;
      if (a > 60) { clearInterval(interval); setPollingIds(p => { const n = new Set(p); n.delete(id); return n; }); return; }
      try {
        const res = await fetch(`${botApiUrl}/api/sessions/${id}/qr`);
        const data = await res.json();
        if (data.status === 'connected') {
          clearInterval(interval);
          setPollingIds(p => { const n = new Set(p); n.delete(id); return n; });
          setQrs(p => { const n = { ...p }; delete n[id]; return n; });
          load();
        } else if (data.status === 'qr_ready' && data.qr) {
          setQrs(p => ({ ...p, [id]: data.qr }));
        }
      } catch {}
    }, 3000);
  };

  const startSession = async (id: number, name: string) => {
    await fetch(`${botApiUrl}/api/sessions/${id}/start`, {
      method: 'POST', headers: hdrs(), body: JSON.stringify({ name, password: pw })
    });
    pollForQR(id);
    setTimeout(load, 1500);
  };

  const conectarNuevo = async () => {
    const id = parseInt(selUser);
    if (!id) return;
    const u = usuarios.find(x => x.id === id);
    await startSession(id, u?.name || `Usuario ${id}`);
    if (selFuente.trim()) {
      await fetch(`${botApiUrl}/api/sessions/${id}/set-fuente`, {
        method: 'POST', headers: hdrs(), body: JSON.stringify({ password: pw, fuente: selFuente.trim() })
      });
    }
    setShowAdd(false);
    setSelUser('');
    setSelFuente('');
  };

  const stopSession = async (id: number) => {
    await fetch(`${botApiUrl}/api/sessions/${id}/stop`, { method: 'POST', headers: hdrs() });
    setTimeout(load, 1000);
  };

  const logoutSession = async (id: number) => {
    if (!confirm('¿Cerrar sesión WA? Vas a tener que escanear QR de nuevo.')) return;
    await fetch(`${botApiUrl}/api/sessions/${id}/logout`, { method: 'POST', headers: hdrs() });
    setQrs(p => { const n = { ...p }; delete n[id]; return n; });
    setTimeout(load, 1000);
  };

  const toggleBot = async (id: number) => {
    await fetch(`${botApiUrl}/api/sessions/${id}/bot-toggle`, {
      method: 'POST', headers: hdrs(), body: JSON.stringify({ password: pw })
    });
    setTimeout(load, 500);
  };

  const setFuente = async (id: number, fuente: string) => {
    await fetch(`${botApiUrl}/api/sessions/${id}/set-fuente`, {
      method: 'POST', headers: hdrs(), body: JSON.stringify({ password: pw, fuente })
    });
    setFuenteEditing(p => ({ ...p, [id]: false }));
    setTimeout(load, 500);
  };

  // Cambiar el gerente/supervisor destino de un chip — backend hace UPDATE gerencia_id, NO desconecta
  const setGerencia = async (id: number, gerenciaId: string) => {
    if (!gerenciaId) { alert('Elegí un gerente/supervisor primero'); return; }
    setSavingGer(p => ({ ...p, [id]: true }));
    try {
      const res = await fetch(`${botApiUrl}/api/sessions/${id}/set-gerencia`, {
        method: 'POST', headers: hdrs(), body: JSON.stringify({ password: pw, gerencia_id: Number(gerenciaId) })
      });
      const data = await res.json();
      if (!data.ok) { alert('❌ ' + (data.error || 'No se pudo cambiar el destino')); }
    } catch {
      alert('❌ Error de conexión con el servidor');
    } finally {
      setSavingGer(p => ({ ...p, [id]: false }));
      setGerSel(p => { const n = { ...p }; delete n[id]; return n; });
      setTimeout(load, 500);
    }
  };

  const toggleMarca = async (id: number, current: string, key: string) => {
    const set = new Set(current ? current.split(',').filter(Boolean) : []);
    if (set.has(key)) set.delete(key); else set.add(key);
    await fetch(`${botApiUrl}/api/sessions/${id}/set-marcas`, {
      method: 'POST', headers: hdrs(), body: JSON.stringify({ password: pw, marcas: Array.from(set) })
    });
    setTimeout(load, 400);
  };

  const usuariosSinSesion = usuarios.filter(u => !sessions.some(s => s.supervisorId === u.id));
  const destinos = usuarios.filter(u => u.role === 'gerente' || u.role === 'supervisor');
  const grupos: [string, Usuario[]][] = [
    ['Gerencias', usuariosSinSesion.filter(u => u.role === 'gerente')],
    ['Supervisores', usuariosSinSesion.filter(u => u.role === 'supervisor')],
    ['Vendedores', usuariosSinSesion.filter(u => u.role === 'vendedor')],
  ];

  // ===== LOGIN SCREEN =====
  if (!authed) {
    return (
      <div className="max-w-sm mx-auto mt-12">
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-xl font-bold mb-1 text-center">🔒 {title}</h2>
          <p className="text-sm text-gray-500 text-center mb-6">Ingresá la contraseña de administrador</p>
          <input
            type="password"
            value={pw}
            onChange={e => { setPw(e.target.value); setLoginErr(false); }}
            onKeyDown={e => e.key === 'Enter' && doLogin()}
            placeholder="Contraseña"
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 mb-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
          <button
            onClick={doLogin}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 font-medium hover:bg-blue-700 transition-colors"
          >
            Entrar
          </button>
          {loginErr && <p className="text-red-500 text-sm mt-3 text-center">Contraseña incorrecta o servidor no disponible</p>}
        </div>
      </div>
    );
  }

  // ===== MAIN PANEL =====
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-800">📱 {title}</h2>
          <span className="text-sm text-gray-400">Números por vendedor, supervisor o gerencia · el chat sale por el número más cercano al lead</span>
        </div>
        <button
          onClick={() => { setShowAdd(v => !v); if (!usuarios.length) loadUsuarios(); }}
          className="px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors whitespace-nowrap"
        >
          ➕ Agregar número
        </button>
      </div>

      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border-2 border-green-200 p-5">
          <h3 className="font-bold text-gray-800 mb-3">Conectar nuevo número</h3>
          <p className="text-xs text-gray-500 mb-3">Elegí de quién es este WhatsApp. Los leads que entren por este número van a esa persona (o a su equipo si es supervisor/gerencia). La fuente sirve para el ruteo: los leads de esa fuente se responden por este número.</p>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={selUser}
              onChange={e => setSelUser(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2.5 bg-white flex-1 min-w-[220px] max-w-md"
            >
              <option value="">— Elegí usuario —</option>
              {grupos.map(([label, items]) => items.length > 0 && (
                <optgroup key={label} label={label}>
                  {items.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </optgroup>
              ))}
            </select>
            <input
              type="text"
              list="fuentes-goldplan"
              value={selFuente}
              onChange={e => setSelFuente(e.target.value)}
              placeholder="Fuente (opcional, ej: Joaquin)"
              className="text-sm border border-gray-300 rounded-lg px-3 py-2.5 flex-1 min-w-[180px] max-w-xs"
            />
            <datalist id="fuentes-goldplan">
              {FUENTES_OPTIONS.filter(f => f).map(f => <option key={f} value={f} />)}
            </datalist>
            <button
              onClick={conectarNuevo}
              disabled={!selUser}
              className="px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Conectar y generar QR
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-2.5 bg-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-300 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          ⚠️ {error} — Verificá que el servidor esté corriendo en <code className="bg-red-100 px-1 rounded text-xs">{botApiUrl}</code>
        </div>
      )}

      {loading && sessions.length === 0 && (
        <div className="flex items-center justify-center p-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600"></div>
          <span className="ml-3 text-gray-500">Conectando...</span>
        </div>
      )}

      {!loading && sessions.length === 0 && !error && (
        <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-500">
          Todavía no hay números conectados. Arrancá con <strong>➕ Agregar número</strong>.
        </div>
      )}

      {sessions.map(s => (
        <div key={s.supervisorId} className="bg-white rounded-xl shadow-sm border p-5">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-lg text-gray-800">{s.supervisorName}</h3>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${(ROLE_BADGE[s.role] || { cls: 'bg-gray-100 text-gray-500' }).cls}`}>
                  {(ROLE_BADGE[s.role] || { label: s.role }).label}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                {s.status === 'connected' ? (
                  <span className="text-green-600 text-sm font-medium">🟢 Conectado{s.phone ? ` — +${s.phone}` : ''}</span>
                ) : s.status === 'qr_ready' ? (
                  <span className="text-yellow-600 text-sm font-medium">🟡 Esperando QR</span>
                ) : s.status === 'connecting' ? (
                  <span className="text-blue-600 text-sm font-medium animate-pulse">🔄 Conectando...</span>
                ) : (
                  <span className="text-red-500 text-sm font-medium">🔴 Desconectado</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium ${s.botEnabled ? 'text-green-600' : 'text-gray-400'}`}>
                  🤖 {s.botEnabled ? 'Bot ON' : 'Bot OFF'}
                </span>
                <button
                  onClick={() => toggleBot(s.supervisorId)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${s.botEnabled ? 'bg-green-500' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${s.botEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              {(s.status === 'disconnected' || !s.status) && (
                <button onClick={() => startSession(s.supervisorId, s.supervisorName)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors">
                  Conectar
                </button>
              )}
              {s.status === 'connected' && (
                <>
                  <button onClick={() => stopSession(s.supervisorId)}
                    className="px-3 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 transition-colors">
                    Desconectar
                  </button>
                  <button onClick={() => logoutSession(s.supervisorId)}
                    className="px-3 py-2 bg-gray-500 text-white rounded-lg text-sm hover:bg-gray-600 transition-colors">
                    Cerrar
                  </button>
                </>
              )}
            </div>
          </div>

          {s.botEnabled && (
            <div className="space-y-2 mt-3">
              {/* Fuente */}
              <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg">
                <span className="text-xs font-medium text-gray-600 whitespace-nowrap">📋 Fuente:</span>
                {!fuenteEditing[s.supervisorId] ? (
                  <>
                    <select
                      value={FUENTES_OPTIONS.includes(s.botFuente) ? s.botFuente : (s.botFuente ? '__custom__' : '')}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === '__custom__') {
                          setFuenteEditing(p => ({ ...p, [s.supervisorId]: true }));
                          setCustomFuente(p => ({ ...p, [s.supervisorId]: s.botFuente || '' }));
                        } else {
                          setFuente(s.supervisorId, val);
                        }
                      }}
                      className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white flex-1 max-w-xs"
                    >
                      <option value="">Auto (detecta origen)</option>
                      {FUENTES_OPTIONS.filter(f => f).map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                      <option value="__custom__">✏️ Custom...</option>
                    </select>
                    {s.botFuente && !FUENTES_OPTIONS.includes(s.botFuente) && (
                      <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                        {s.botFuente}
                      </span>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={customFuente[s.supervisorId] || ''}
                      onChange={e => setCustomFuente(p => ({ ...p, [s.supervisorId]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && setFuente(s.supervisorId, customFuente[s.supervisorId] || '')}
                      placeholder="Escribí la fuente..."
                      className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 flex-1"
                      autoFocus
                    />
                    <button
                      onClick={() => setFuente(s.supervisorId, customFuente[s.supervisorId] || '')}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => setFuenteEditing(p => ({ ...p, [s.supervisorId]: false }))}
                      className="px-3 py-1.5 bg-gray-300 text-gray-700 rounded-lg text-xs hover:bg-gray-400"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>

              {/* Marcas */}
              <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg flex-wrap">
                <span className="text-xs font-medium text-gray-600 whitespace-nowrap">🚗 Marcas que ofrece:</span>
                {MARCAS.map(m => {
                  const activas = s.botMarcas ? s.botMarcas.split(',').filter(Boolean) : [];
                  const checked = activas.includes(m.key);
                  return (
                    <label key={m.key} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMarca(s.supervisorId, s.botMarcas, m.key)}
                        className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                      />
                      {m.label}
                    </label>
                  );
                })}
                {!s.botMarcas && (
                  <span className="text-xs text-amber-700 bg-amber-100 px-2 py-1 rounded">Sin tildar = ofrece TODAS</span>
                )}
              </div>
            </div>
          )}

          {/* Destino de los leads — cambia sin desconectar el chip */}
          <div className="flex items-center gap-2 mt-3 p-3 bg-purple-50 rounded-lg">
            <span className="text-xs font-medium text-gray-600 whitespace-nowrap">🏢 Destino:</span>
            <select
              value={gerSel[s.supervisorId] ?? (s.gerenciaId ? String(s.gerenciaId) : '')}
              onChange={e => setGerSel(p => ({ ...p, [s.supervisorId]: e.target.value }))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white flex-1 max-w-xs"
            >
              <option value="">Elegí gerente/supervisor...</option>
              {destinos.map(u => (
                <option key={u.id} value={u.id}>{u.name}{u.role === 'supervisor' ? ' (sup.)' : ''}</option>
              ))}
            </select>
            <button
              onClick={() => setGerencia(s.supervisorId, gerSel[s.supervisorId] ?? (s.gerenciaId ? String(s.gerenciaId) : ''))}
              disabled={!!savingGer[s.supervisorId]}
              className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap"
            >
              {savingGer[s.supervisorId] ? 'Guardando...' : 'Cambiar destino'}
            </button>
          </div>

          {qrs[s.supervisorId] && (
            <div className="text-center p-4 bg-gray-50 rounded-lg mt-3">
              <p className="text-sm text-gray-600 mb-3">Escaneá con el celular de {s.supervisorName}</p>
              <img src={qrs[s.supervisorId]} alt="QR" className="mx-auto w-64 h-64" />
              <p className="text-xs text-gray-400 mt-2 animate-pulse">Esperando escaneo...</p>
            </div>
          )}

          {pollingIds.has(s.supervisorId) && !qrs[s.supervisorId] && s.status !== 'connected' && (
            <div className="text-center p-4 bg-gray-50 rounded-lg mt-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400 mx-auto"></div>
              <p className="text-xs text-gray-400 mt-2">Generando QR...</p>
            </div>
          )}
        </div>
      ))}

      <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-500 space-y-1">
        <p>• <strong>De quién es el número:</strong> vendedor → sus leads entran directo a él · supervisor/gerencia → round-robin en su equipo</p>
        <p>• <strong>Respuestas desde el CRM:</strong> salen por el número del vendedor asignado; si no tiene, por el de su supervisor; si no, el de la gerencia</p>
        <p>• <strong>Bot ON:</strong> la IA responde sola y solo ofrece las marcas tildadas · <strong>Bot OFF:</strong> chat manual desde el CRM</p>
        <p>• <strong>Cerrar:</strong> desvincula WhatsApp por completo, hay que escanear QR de nuevo</p>
      </div>
    </div>
  );
}