

export { doctorProject } from "./composition/project.js";
export { hasDoctorErrors,redactDoctorReportForMcp } from "./domain/indexing/diagnostics.js";
export type { DoctorAdapterRun,DoctorCoverage,DoctorFinding,DoctorFindingSeverity,DoctorIndexRun,DoctorOptions,DoctorReport,DoctorTableState } from "./domain/indexing/diagnostics.js";
export { REQUIRED_SCHEMA_VERSION } from "./infrastructure/sqlite/doctor.js";
