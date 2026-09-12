import { isMissingSchemaColumn } from "./performanceKpis.js";
import { classifyResumeTeamLeaders, resolveResumeTeamLeader } from "./dailySalesmanResume.js";
import { buildTeamDirectoryMembers, NO_TEAM_MOM_KEY } from "./salesmanTeamMom.js";

async function listProfiles(admin) {
  const full = "id,salesman_code,salesman_name,role,is_active";
  const fallback = "id,salesman_code,salesman_name,role";
  let result = await admin.from("profiles").select(full).order("salesman_name");
  if (result.error && isMissingSchemaColumn(result.error)) {
    result = await admin.from("profiles").select(fallback).order("salesman_name");
  }
  if (result.error) throw result.error;
  // Keep inactive salesmen. Hierarchy mapping still applies; only people
  // with no boss/team land in No team.
  return result.data || [];
}

async function listAuthUsers(admin) {
  if (typeof admin?.auth?.admin?.listUsers !== "function") return [];
  const result = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (result.error) throw result.error;
  return result.data?.users || [];
}

export async function loadSalesmanTeamMembers(admin) {
  const [profiles, authUsers] = await Promise.all([
    listProfiles(admin),
    listAuthUsers(admin),
  ]);
  const { firstLevelIds } = classifyResumeTeamLeaders({ profiles, authUsers });
  return buildTeamDirectoryMembers(profiles, (profile) => {
    const team = resolveResumeTeamLeader({
      userId: profile.id,
      salesmanName: profile.salesman_name,
      salesmanCode: profile.salesman_code,
    }, { profiles, authUsers, firstLevelIds });
    if (!team.teamLeaderUserId) {
      return { teamKey: NO_TEAM_MOM_KEY };
    }
    return {
      teamKey: team.teamLeaderUserId,
      teamLeaderUserId: team.teamLeaderUserId,
      teamLeaderCode: team.teamLeaderCode,
      teamLeaderName: team.teamLeaderName,
    };
  });
}
