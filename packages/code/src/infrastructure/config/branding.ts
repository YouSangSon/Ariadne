

export function envValue(name: string): string | undefined {
  return process.env[`PARALLAX_${name}`];
}
export { DATA_DIR,PACKAGE_NAME,PRODUCT_NAME } from "../../domain/branding.js";
