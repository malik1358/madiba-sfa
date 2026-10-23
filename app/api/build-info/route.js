import { resolveBuildId, resolveBuildTime, formatBuildDateTime } from "../../lib/buildInfo.js";
import { resolveAppEnvironmentLabel } from "../../lib/appEnvironment.js";

// The build id is fixed when this deployment is built. Serve the JSON as a
// static file so open tabs do not invoke a function on every poll.
export const dynamic = "force-static";

export async function GET() {
  return Response.json(
    {
      success: true,
      buildId: resolveBuildId(),
      buildTime: formatBuildDateTime(resolveBuildTime()),
      environment: resolveAppEnvironmentLabel(),
    },
    {
      headers: {
        // Browsers revalidate every poll. The CDN reuses one response for a minute
        // so open tabs do not each invoke a function. A new production deployment
        // replaces this response.
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
