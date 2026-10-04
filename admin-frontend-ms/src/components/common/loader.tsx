/**
 * The SBC loading screen from the original admin: the SIMBTECH / SBC mark over
 * a sliding blue bar. `compact` keeps only the bar, for a page loading inside
 * the admin (the full mark would flash on every navigation).
 */
function Loader({ name, compact = false }: { name?: string; compact?: boolean }) {
  return (
    <div className="sbc-loader" role="status" aria-label={name ? `Chargement : ${name}` : 'Chargement'}>
      {!compact && (
        <div className="sbc-loader-mark">
          <p className="sbc-loader-top">SIMBTECH</p>
          <p className="sbc-loader-mid">{name || 'Admin'}<span>SBC</span></p>
          <p className="sbc-loader-bottom">Professional</p>
        </div>
      )}
      <div className="sbc-loader-track" aria-hidden>
        {Array.from({ length: 3 }, (_, i) => <span key={i} className="sbc-loader-box" />)}
      </div>
    </div>
  );
}

export default Loader;
