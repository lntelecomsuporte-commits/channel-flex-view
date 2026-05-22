import * as jose from "https://deno.land/x/jose@v4.14.4/index.ts";

console.log("main function started");

const JWT_SECRET = Deno.env.get("JWT_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const VERIFY_JWT = Deno.env.get("VERIFY_JWT") === "true";

let SUPABASE_JWT_KEYS: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
if (SUPABASE_URL) {
  try {
    SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", SUPABASE_URL));
  } catch (error) {
    console.error("Failed to fetch JWKS from SUPABASE_URL:", error);
  }
}

function getAuthToken(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Missing authorization header");
  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer") throw new Error("Auth header is not 'Bearer {token}'");
  return token;
}

async function isValidLegacyJWT(jwt: string): Promise<boolean> {
  if (!JWT_SECRET) {
    console.error("JWT_SECRET not available for HS256 token verification");
    return false;
  }

  try {
    await jose.jwtVerify(jwt, new TextEncoder().encode(JWT_SECRET));
    return true;
  } catch (error) {
    console.error("Symmetric Legacy JWT verification error", error);
    return false;
  }
}

async function isValidJWT(jwt: string): Promise<boolean> {
  if (!SUPABASE_JWT_KEYS) {
    console.error("JWKS not available for ES256/RS256 token verification");
    return false;
  }

  try {
    await jose.jwtVerify(jwt, SUPABASE_JWT_KEYS);
    return true;
  } catch (error) {
    console.error("Asymmetric JWT verification error", error);
    return false;
  }
}

async function isValidHybridJWT(jwt: string): Promise<boolean> {
  const { alg } = jose.decodeProtectedHeader(jwt);
  if (alg === "HS256") return await isValidLegacyJWT(jwt);
  if (alg === "ES256" || alg === "RS256") return await isValidJWT(jwt);
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "OPTIONS" && VERIFY_JWT) {
    try {
      const token = getAuthToken(req);
      if (!(await isValidHybridJWT(token))) {
        return new Response(JSON.stringify({ msg: "Invalid JWT" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch (error) {
      console.error(error);
      return new Response(JSON.stringify({ msg: String(error) }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const url = new URL(req.url);
  const serviceName = url.pathname.split("/")[1];

  if (!serviceName) {
    return new Response(JSON.stringify({ msg: "missing function name in request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const servicePath = `/home/deno/functions/${serviceName}`;
  console.error(`serving the request with ${servicePath}`);

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: 150,
      workerTimeoutMs: 60_000,
      noModuleCache: false,
      importMapPath: null,
      envVars: Object.entries(Deno.env.toObject()),
    });
    return await worker.fetch(req);
  } catch (error) {
    return new Response(JSON.stringify({ msg: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});