/** shimmering placeholder rows matching the RequestRow grid */
export function SkeletonRows({ n = 6 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div className="qrow" key={i} aria-hidden="true">
          <span />
          <span>
            <span className="skel" style={{ display: 'inline-block', width: 34, height: 14, marginBottom: 4 }} />
            <br />
            <span className="skel" style={{ display: 'inline-block', width: 62, height: 11 }} />
          </span>
          <span>
            <span className="skel" style={{ display: 'block', width: `${55 + (i * 13) % 35}%`, height: 14, marginBottom: 5 }} />
            <span className="skel" style={{ display: 'block', width: `${30 + (i * 7) % 25}%`, height: 10 }} />
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span className="skel" style={{ width: 22, height: 22, borderRadius: '50%' }} />
            <span className="skel" style={{ width: 70, height: 11 }} />
          </span>
          <span><span className="skel" style={{ display: 'inline-block', width: 52, height: 22, borderRadius: 11 }} /></span>
          <span><span className="skel" style={{ display: 'inline-block', width: 80, height: 20, borderRadius: 99 }} /></span>
          <span />
        </div>
      ))}
    </>
  )
}
