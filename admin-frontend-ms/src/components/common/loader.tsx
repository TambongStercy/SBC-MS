/** The original SIMBTECH / SBC loading screen, in the theme's colours (styles in index.css). */
function Loader({ name }: { name: string }) {
  return (
    <div className="window" role="status" aria-live="polite">
      <div className="sbc-loader-logo">
        <p className="sbc-loader-top">SIMBTECH</p>
        <p className="sbc-loader-mid">{name}<span>SBC</span></p>
        <p className="sbc-loader-bottom">Professional</p>
      </div>
      <div className="sbc-loader-track" aria-hidden="true">
        <div className="sbc-loader-box"></div>
        <div className="sbc-loader-box"></div>
        <div className="sbc-loader-box"></div>
      </div>
      <span className="sr-only">Chargement…</span>
    </div>
  )
}

export default Loader
