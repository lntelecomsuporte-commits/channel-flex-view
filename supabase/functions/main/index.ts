declare const EdgeRuntime: {
  userWorkers: {
    create: (options: Record<string, unknown>) => Promise<{ fetch: (req: Request) => Promise<Response> }>;
  };
};

type DenoWorkerErrors = typeof Deno.errors & {
  WorkerAlreadyRetired?: new (...args: never[]) => Error;
  WorkerRequestIdleTimeout?: new (...args: never[]) => Error;
};

console.log("main function started");

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json" };
  const url = new URL(req.url);
  const serviceName = url.pathname.split("/")[1];

  if (!serviceName) {
    return new Response(JSON.stringify({ msg: "missing function name in request" }), {
      status: 400,
      headers,
    });
  }

  const servicePath = `/home/deno/functions/${serviceName}`;
  console.error(`serving the request with ${servicePath}`);

  const envVarsObj = Deno.env.toObject();
  const envVars = Object.keys(envVarsObj).map((key) => [key, envVarsObj[key]]);

  const callWorker = async (): Promise<Response> => {
    try {
      const worker = await EdgeRuntime.userWorkers.create({
        servicePath,
        memoryLimitMb: 150,
        workerTimeoutMs: 5 * 60 * 1000,
        noModuleCache: false,
        envVars,
        forceCreate: false,
        cpuTimeSoftLimitMs: 10_000,
        cpuTimeHardLimitMs: 20_000,
        staticPatterns: ["/home/deno/functions/**/*.html", "/home/deno/functions/**/*.wasm"],
        context: { useReadSyncFileAPI: true },
      });

      return await worker.fetch(req);
    } catch (error) {
      const workerErrors = Deno.errors as DenoWorkerErrors;

      if (workerErrors.WorkerAlreadyRetired && error instanceof workerErrors.WorkerAlreadyRetired) {
        return await callWorker();
      }

      if (workerErrors.WorkerRequestIdleTimeout && error instanceof workerErrors.WorkerRequestIdleTimeout) {
        return new Response(JSON.stringify({ msg: String(error) }), {
          status: 504,
          headers,
        });
      }

      return new Response(JSON.stringify({ msg: String(error) }), {
        status: 500,
        headers,
      });
    }
  };

  return await callWorker();
});