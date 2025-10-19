import pm2 from "pm2";
import type { ProcessDescription, StartOptions } from "pm2";

export interface ManagedProcess {
    pmId: number;
    name: string;
    namespace?: string;
    pid?: number;
    status: string;
    uptime?: number;
    cpu?: number;
    memory?: number;
    instances?: number | "max";
    restarts?: number;
    script?: string;
    execMode?: string;
}

export type LogListener = (message: string, proc: ProcessDescription) => void;

export class PM2Client {
    private connected = false;

    async ensureConnected(): Promise<void> {
        if (this.connected) return;

        await new Promise<void>((resolve, reject) => {
            pm2.connect((err) => {
                if (err) {
                    reject(err);
                } else {
                    this.connected = true;
                    resolve();
                }
            });
        });
    }

    async disconnect(): Promise<void> {
        if (!this.connected) return;
        pm2.disconnect();
        this.connected = false;
    }

    async listProcesses(): Promise<ManagedProcess[]> {
        await this.ensureConnected();
        const list = await new Promise<ProcessDescription[]>(
            (resolve, reject) => {
                pm2.list((err, processDescriptionList) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(processDescriptionList);
                    }
                });
            },
        );

        type ExtendedPm2Env = NonNullable<ProcessDescription["pm2_env"]> & {
            namespace?: string;
            exec_mode?: string;
        };

        return list.map((proc) => ({
            pmId: proc.pm_id ?? -1,
            name: proc.name ?? "unknown",
            namespace:
                (proc.pm2_env as ExtendedPm2Env | undefined)?.namespace ??
                "default",
            pid: proc.pid,
            status: proc.pm2_env?.status ?? "unknown",
            uptime: proc.pm2_env?.pm_uptime
                ? Date.now() - proc.pm2_env.pm_uptime
                : undefined,
            cpu: proc.monit?.cpu,
            memory: proc.monit?.memory,
            instances: proc.pm2_env?.instances,
            restarts: proc.pm2_env?.restart_time,
            script: proc.pm2_env?.pm_exec_path,
            execMode: (proc.pm2_env as ExtendedPm2Env | undefined)?.exec_mode,
        }));
    }

    async startAll(): Promise<void> {
        await this.ensureConnected();
        await this.execCommand((cb) => pm2.start("all", cb));
    }

    async stopAll(): Promise<void> {
        await this.ensureConnected();
        await this.execCommand((cb) => pm2.stop("all", cb));
    }

    async restartAll(): Promise<void> {
        await this.ensureConnected();
        await this.execCommand((cb) => pm2.restart("all", cb));
    }

    async reloadAll(): Promise<void> {
        await this.ensureConnected();
        await this.execCommand((cb) => pm2.reload("all", cb));
    }

    async startProcess(target: string | StartOptions): Promise<void> {
        await this.ensureConnected();
        await this.execCommand((cb) => {
            if (typeof target === "string") {
                pm2.start(target, cb);
            } else {
                pm2.start(target, cb);
            }
        });
    }

    async stopProcess(idOrName: number | string): Promise<void> {
        await this.ensureConnected();
        await this.execCommand((cb) => pm2.stop(idOrName, cb));
    }

    async restartProcess(idOrName: number | string): Promise<void> {
        await this.ensureConnected();
        await this.execCommand((cb) => pm2.restart(idOrName, cb));
    }

    async deleteProcess(idOrName: number | string): Promise<void> {
        await this.ensureConnected();
        await this.execCommand((cb) => pm2.delete(idOrName, cb));
    }

    async reloadProcess(idOrName: number | string): Promise<void> {
        await this.ensureConnected();
        await this.execCommand((cb) => pm2.reload(idOrName, cb));
    }

    async launchBus(
        onStdout: LogListener,
        onStderr: LogListener,
    ): Promise<() => void> {
        await this.ensureConnected();

        const bus = await new Promise<any>((resolve, reject) => {
            pm2.launchBus((err, messageBus) => {
                if (err || !messageBus) {
                    reject(err ?? new Error("pm2 bus unavailable"));
                } else {
                    resolve(messageBus);
                }
            });
        });

        const handleLog = (packet: any) => {
            const proc = packet.process;
            if (!proc) return;
            const message = packet.data.toString("utf8");
            onStdout(message, proc as ProcessDescription);
        };

        const handleErrorLog = (packet: any) => {
            const proc = packet.process;
            if (!proc) return;
            const message = packet.data.toString("utf8");
            onStderr(message, proc as ProcessDescription);
        };

        bus.on("log:out", handleLog);
        bus.on("log:err", handleErrorLog);

        return () => {
            bus.removeListener("log:out", handleLog);
            bus.removeListener("log:err", handleErrorLog);
            bus.close();
        };
    }

    private async execCommand(
        command: (cb: (err?: Error | null, ...args: unknown[]) => void) => void,
    ): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const callback = (err?: Error | null) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            };
            command(callback);
        });
    }
}
