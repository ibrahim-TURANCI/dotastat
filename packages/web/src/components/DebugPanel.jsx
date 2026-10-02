import { useState } from "react";
import { api, ROSTER_CHANGED_EVENT } from "../lib/api.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { formatRelativeTime } from "../lib/format.js";
import { Accordion, EmptyState, SkeletonBlock } from "./primitives.jsx";
import "./DebugPanel.css";

/**
 * Debug paneli.
 *
 * Ekranda KAPALI bir akordeon olarak durur; ancak tiklandiginda acilir ve
 * ilk o zaman veri ceker (Accordion govdeyi kapaliyken hic cizmez).
 *
 * @param {{ live: Record<string, any>|null, user: Record<string, any>|null }} props
 */
export function DebugPanel({ live, user }) {
  return (
    <Accordion title="Debug Panel" hint="tıklayınca açılır">
      <DebugBody live={live} user={user} />
    </Accordion>
  );
}

/**
 * @param {{ live: Record<string, any>|null, user: Record<string, any>|null }} props
 */
function DebugBody({ live, user }) {
  const debug = useAsyncData(() => api.debug(), { intervalMs: 30000 });

  if (debug.loading) {
    return <SkeletonBlock lines={5} height={18} />;
  }

  if (debug.error) {
    return (
      <EmptyState
        title="Debug verisi alınamadı"
        detail={debug.error.message}
        action={
          <button type="button" className="btn small" onClick={debug.reload}>
            Tekrar dene
          </button>
        }
      />
    );
  }

  const data = debug.data || {};

  return (
    <div className="debug-grid">
      <DebugCard title="Çalışma ortamı">
        <DebugRow label="Node" value={data.runtime?.node} />
        <DebugRow label="Bölge" value={data.runtime?.region || "-"} />
        <DebugRow label="Branch" value={data.runtime?.branch || "-"} />
        <DebugRow
          label="Commit"
          value={(data.runtime?.commit || "-").slice(0, 8)}
        />
        <DebugRow label="Yanıt süresi" value={data.durationMs + " ms"} />
      </DebugCard>

      <DebugCard title="Yapılandırma">
        <DebugFlag label="OpenDota anahtarı" on={data.config?.openDotaKey} />
        <DebugFlag label="Oturum imzası" on={data.config?.sessionSecret} />
        <DebugFlag
          label="Canlı yayın jetonu"
          on={data.config?.liveIngestToken}
        />
        <DebugFlag label="Netlify Blobs" on={data.config?.blobsAvailable} />
        <DebugRow label="Release repo" value={data.config?.githubRepo || "-"} />
      </DebugCard>

      <DebugCard title="Oturum / canlı">
        <DebugRow label="Giriş" value={user ? user.name : "yapılmadı"} />
        <DebugRow
          label="Canlı maç"
          value={live?.active ? live.matchId || "aktif" : "yok"}
        />
        <DebugRow label="Faz" value={live?.phase || "-"} />
        <DebugRow label="Draft aşaması" value={live?.draft?.stage || "-"} />
        <DebugRow
          label="Yayıncı istemci"
          value={String(data.live?.uploaderCount ?? 0)}
        />
        <DebugRow
          label="Online kullanıcı"
          value={String(data.presence?.userCount ?? 0)}
        />
      </DebugCard>

      {/*
        Overwolf ISTEGE BAGLI ek kaynaktir. Kurulu degilse burasi "yok" der;
        bu bir hata degildir, uygulama GSI ile tam calisir. Kart yalnizca
        masaustunde doludur (sitede boyle bir okuma yapilmaz).
      */}
      <DebugCard title="Overwolf / DotaPlus">
        <DebugFlag
          label="Log okunuyor"
          on={Boolean(data.live?.overwolf?.available)}
        />
        <DebugRow
          label="Durum"
          value={data.live?.overwolf?.error || "çalışıyor"}
        />
        <DebugRow label="Maç" value={data.live?.overwolf?.matchId || "-"} />
        <DebugRow
          label="Etkinlik"
          value={data.live?.overwolf?.activity || "-"}
        />
        <DebugRow
          label="Okunan pick"
          value={String(data.live?.overwolf?.picks ?? 0) + " / 10"}
        />
        <DebugRow
          label="Okunan rank"
          value={String(data.live?.overwolf?.ranks ?? 0) + " / 10"}
        />
        <DebugRow
          label="Son satır"
          value={
            data.live?.overwolf?.at
              ? formatRelativeTime(data.live.overwolf.at)
              : "-"
          }
        />
      </DebugCard>

      <RosterCard roster={data.roster} onChanged={debug.reload} />

      <div className="debug-actions">
        <button
          type="button"
          className="btn small"
          onClick={debug.reload}
          disabled={debug.refreshing}
        >
          {debug.refreshing ? "Yenileniyor…" : "Yenile"}
        </button>
        <span className="muted micro">
          üretildi: {formatRelativeTime(data.generatedAt)}
        </span>
      </div>
    </div>
  );
}

/**
 * Onbellek tablosu + kadro yonetimi.
 *
 * Islemler (ekle / gizle / goster / duzenle / sil) yalnizca katalog
 * yoneticisine gorunur — "Tavsiyeleri yonet" ekranindaki Kaydet dugmesiyle
 * ayni kural. Sunucu ayni sarti bagimsiz olarak uygular.
 *
 * @param {{ roster: Record<string, any>|undefined, onChanged: () => void }} props
 */
function RosterCard({ roster, onChanged }) {
  const canManage = Boolean(roster?.canManage);
  const players = roster?.players || [];
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  /**
   * @param {Record<string, string>} change
   * @returns {Promise<boolean>}
   */
  async function run(change) {
    setBusy(change.id || change.action);
    setError("");
    try {
      await api.rosterChange(change);
      window.dispatchEvent(new Event(ROSTER_CHANGED_EVENT));
      onChanged();
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    } finally {
      setBusy("");
    }
  }

  return (
    <DebugCard
      title={"Önbellek (" + (roster?.count ?? 0) + " oyuncu)"}
      wide
      action={
        canManage && !adding ? (
          <button
            type="button"
            className="btn small primary"
            onClick={() => {
              setAdding(true);
              setEditingId("");
            }}
          >
            + Oyuncu Ekle
          </button>
        ) : null
      }
    >
      {adding ? (
        <RosterForm
          submitLabel="Ekle"
          busy={busy === "add"}
          namePlaceholder="İsim (boşsa profil adı)"
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            if (await run({ action: "add", ...values })) {
              setAdding(false);
            }
          }}
        />
      ) : null}

      {error ? <p className="debug-error">{error}</p> : null}

      <table className="data-table">
        <thead>
          <tr>
            <th>Oyuncu</th>
            <th>Account ID</th>
            <th>Maç</th>
            <th>Değerlendirme</th>
            <th>Güncellendi</th>
            {canManage ? <th className="debug-ops-head">İşlemler</th> : null}
          </tr>
        </thead>
        <tbody>
          {players.map((row) =>
            editingId === row.id ? (
              <tr key={row.id}>
                <td colSpan={canManage ? 6 : 5}>
                  <RosterForm
                    initial={{ name: row.name, accountId: row.accountId }}
                    submitLabel="Kaydet"
                    busy={busy === row.id}
                    accountLocked={row.catalogAdmin}
                    onCancel={() => setEditingId("")}
                    onSubmit={async (values) => {
                      if (
                        await run({ action: "edit", id: row.id, ...values })
                      ) {
                        setEditingId("");
                      }
                    }}
                  />
                </td>
              </tr>
            ) : (
              <tr key={row.id} className={row.hidden ? "debug-row-hidden" : ""}>
                <td>
                  {row.name}
                  {row.hidden ? <span className="chip warn">gizli</span> : null}
                </td>
                <td className="mono">{row.accountId}</td>
                <td>{row.matchCount}</td>
                <td>{row.evaluationCount}</td>
                <td className="muted">
                  {row.fetchedAt ? formatRelativeTime(row.fetchedAt) : "hiç"}
                </td>
                {canManage ? (
                  <td>
                    <div className="debug-ops">
                      <button
                        type="button"
                        className="btn small ghost"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          run({
                            action: row.hidden ? "show" : "hide",
                            id: row.id,
                          })
                        }
                      >
                        {row.hidden ? "Göster" : "Gizle"}
                      </button>
                      <button
                        type="button"
                        className="btn small ghost"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          setEditingId(row.id);
                          setAdding(false);
                          setError("");
                        }}
                      >
                        Düzenle
                      </button>
                      <button
                        type="button"
                        className="btn small ghost danger"
                        disabled={Boolean(busy) || row.catalogAdmin}
                        title={
                          row.catalogAdmin
                            ? "Katalog yöneticisi silinemez"
                            : undefined
                        }
                        onClick={() => {
                          if (
                            window.confirm(
                              row.name +
                                " kadrodan silinsin mi? Önbellekteki maç verisi silinmez; aynı Account ID ile yeniden eklenebilir.",
                            )
                          ) {
                            run({ action: "delete", id: row.id });
                          }
                        }}
                      >
                        Sil
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </DebugCard>
  );
}

/**
 * Oyuncu ekleme / duzenleme satiri.
 *
 * @param {{
 *   initial?: { name: string, accountId: string },
 *   submitLabel: string,
 *   busy: boolean,
 *   accountLocked?: boolean,
 *   namePlaceholder?: string,
 *   onSubmit: (values: { name: string, accountId: string }) => void,
 *   onCancel: () => void,
 * }} props
 */
function RosterForm({
  initial = { name: "", accountId: "" },
  submitLabel,
  busy,
  accountLocked = false,
  namePlaceholder = "İsim",
  onSubmit,
  onCancel,
}) {
  const [accountId, setAccountId] = useState(initial.accountId);
  const [name, setName] = useState(initial.name);

  return (
    <form
      className="debug-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ accountId: accountId.trim(), name: name.trim() });
      }}
    >
      <input
        className="debug-input mono"
        value={accountId}
        placeholder="Account ID (ya da SteamID64)"
        inputMode="numeric"
        disabled={accountLocked}
        title={
          accountLocked
            ? "Katalog yöneticisinin Account ID değeri değiştirilemez"
            : undefined
        }
        onChange={(event) => setAccountId(event.target.value)}
        autoFocus={!accountLocked}
      />
      <input
        className="debug-input"
        value={name}
        placeholder={namePlaceholder}
        onChange={(event) => setName(event.target.value)}
        autoFocus={accountLocked}
      />
      <button
        type="submit"
        className="btn small primary"
        disabled={busy || !/^\d+$/.test(accountId.trim())}
      >
        {busy ? "Kaydediliyor…" : submitLabel}
      </button>
      <button type="button" className="btn small ghost" onClick={onCancel}>
        Vazgeç
      </button>
    </form>
  );
}

/**
 * @param {{ title: string, wide?: boolean, action?: React.ReactNode, children: React.ReactNode }} props
 */
function DebugCard({ title, wide = false, action = null, children }) {
  return (
    <article className={"debug-card" + (wide ? " wide" : "")}>
      <div className="debug-card-head">
        <h4>{title}</h4>
        {action}
      </div>
      <div className="debug-card-body">{children}</div>
    </article>
  );
}

/**
 * @param {{ label: string, value: string }} props
 */
function DebugRow({ label, value }) {
  return (
    <div className="debug-row">
      <span className="muted">{label}</span>
      <span className="mono">{value ?? "-"}</span>
    </div>
  );
}

/**
 * @param {{ label: string, on: boolean }} props
 */
function DebugFlag({ label, on }) {
  return (
    <div className="debug-row">
      <span className="muted">{label}</span>
      <span className={"chip " + (on ? "good" : "bad")}>
        {on ? "tanımlı" : "yok"}
      </span>
    </div>
  );
}
