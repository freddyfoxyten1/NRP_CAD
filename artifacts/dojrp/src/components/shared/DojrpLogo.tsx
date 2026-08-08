/**
 * Renders "DOJRP" with per-letter brand colours:
 *   D   = Blue  (#2f70ff)
 *   OJR = White (#ffffff)
 *   P   = Red   (#ff5d5d)
 *
 * Inherits font-size, weight, tracking, and uppercase transforms from the parent.
 */
const DojrpLogo = () => (
  <span className="dojrp-logo">
    <span style={{ color: '#2f70ff' }}>D</span>
    <span style={{ color: '#ffffff' }}>OJR</span>
    <span style={{ color: '#ff5d5d' }}>P</span>
  </span>
);

export default DojrpLogo;
