/**
 * Dogfood-testing services — pipeline-driving gate and report contract (@1.2).
 * Absorbed from plugins/sp/lib/dogfood-* + scripts/dogfood-testing/* (script-absorption PR-7).
 */
export {
    DOGFOOD_GATE_USAGE,
    type DogfoodGateCliArgs,
    parseDogfoodGateArgs,
    runDogfoodGateCli,
} from './gate-cli';
export {
    detectImplementHeavy,
    detectPipelineDriving,
    evaluateDogfoodGate,
    type GateResult,
    hasMutatingFixMode,
    IMPLEMENT_HEAVY_ADVISORY_MESSAGE,
    isImplementHeavyStep,
    MUTATING_FIX_REFUSE_MESSAGE,
    PIPELINE_DRIVING_REFUSE_MESSAGE,
    PIPELINE_TOKENS,
} from './pipeline-detect';
export { type ReportValidation, validateReport } from './report';
export {
    DOGFOOD_VALIDATE_USAGE,
    type DogfoodReportReader,
    type DogfoodValidateCliArgs,
    parseDogfoodValidateArgs,
    runDogfoodValidateCli,
} from './validate-cli';
