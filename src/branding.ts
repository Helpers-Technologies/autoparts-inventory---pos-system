/**
 * Per-client white-label branding baked into a build.
 *
 * Leave every field empty for the generic edition — the first-run wizard then
 * starts blank and the client types their own company name / uploads their logo.
 *
 * To prepare a branded edition for a specific client (so the technician only
 * clicks «التالي» without typing anything), fill these in before building:
 *   - companyNameAr : the client's Arabic company name (pre-filled, still editable)
 *   - companyName   : optional English name shown under the Arabic one
 *   - logoImage     : a data URL (data:image/png;base64,...) or an imported asset
 *
 * Keep the committed values empty; set them only for the client build, then
 * run `npm run dist:win`.
 */
export const BRANDING: {
  companyNameAr: string;
  companyName: string;
  logoImage: string;
} = {
  companyNameAr: "",
  companyName: "",
  logoImage: "",
};
