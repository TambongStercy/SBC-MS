function Loader({name}: {name: string}) {
  return (
    <>
<div className="window">
  <div className="logo">
    <p className="top">SIMBTECH</p>
    <p className="mid">{name}<span>SBC</span></p>
    <p className="bottom">Professional</p>
  </div>
  <div className="container">
    <div className="box"></div>
    <div className="box"></div>
    <div className="box"></div>
  </div>
</div>
    </>
  )
}

export default Loader
