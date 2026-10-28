// Files imported `with { type: "file" }` (the command line's embedded assets) are paths.
declare module "*.wasm" {
  const path: string;
  export default path;
}
declare module "*.ttf" {
  const path: string;
  export default path;
}
