/** Ambient declaration for CSS Modules (tsdown compiles them to class maps). */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
