import { api } from "../lib/api.js";
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

      <DebugCard
        title={"Önbellek (" + (data.roster?.count ?? 0) + " oyuncu)"}
        wide
      >
        <table className="data-table">
          <thead>
            <tr>
              <th>Oyuncu</th>
              <th>Account ID</th>
              <th>Maç</th>
              <th>Değerlendirme</th>
              <th>Güncellendi</th>
            </tr>
          </thead>
          <tbody>
            {(data.roster?.players || []).map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td className="mono">{row.accountId}</td>
                <td>{row.matchCount}</td>
                <td>{row.evaluationCount}</td>
                <td className="muted">
                  {row.fetchedAt ? formatRelativeTime(row.fetchedAt) : "hiç"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DebugCard>

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
 * @param {{ title: string, wide?: boolean, children: React.ReactNode }} props
 */
function DebugCard({ title, wide = false, children }) {
  return (
    <article className={"debug-card" + (wide ? " wide" : "")}>
      <h4>{title}</h4>
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
