// The toy dataDir carries its own evaluator per the contract. Re-exported rather than copied:
// the CONTRACT is "the folder resolves selector-evaluator.js"; the toy proves resolution, and a
// copy here would be a second evaluator that drifts (the exact defect class the standard avoids).
export { evaluate } from '../../../plugin-designs/my-upg-100-list/data/selector-evaluator.js'
