import os from "node:os";
import blessed, { Widgets } from "blessed";
// @ts-ignore – blessed-contrib ships without TypeScript types.
import contrib from "blessed-contrib";
import chalk from "chalk";
import si from "systeminformation";
import { PM2Client } from "../services/pm2Client";
import type { ManagedProcess } from "../services/pm2Client";
import { formatBytes, formatCpu, formatUptime } from "../utils/format";

interface ActionDefinition {
    label: string;
    handler: (proc: ManagedProcess) => Promise<void>;
    confirm?: boolean;
}

const REFRESH_INTERVAL_MS = 4000;
const STATS_INTERVAL_MS = 3000;
const HISTORY_LENGTH = 30;

const STATUS_STYLES: Record<
    string,
    { icon: string; color: string; label: string }
> = {
    online: { icon: "●", color: "green", label: "ONLINE" },
    stopped: { icon: "○", color: "yellow", label: "STOPPED" },
    errored: { icon: "✖", color: "red", label: "ERRORED" },
    stopping: { icon: "■", color: "magenta", label: "STOPPING" },
    launching: { icon: "▲", color: "cyan", label: "LAUNCHING" },
};

export class App {
    private readonly hostname = os.hostname();
    private readonly screen: Widgets.Screen;
    private readonly grid: any;
    private readonly headerBox: Widgets.BoxElement;
    private readonly summaryBox: Widgets.BoxElement;
    private readonly actionsBox: Widgets.BoxElement;
    private readonly processTable: any;
    private readonly detailBox: Widgets.BoxElement;
    private readonly statsBox: Widgets.BoxElement;
    private readonly insightsBox: Widgets.BoxElement;
    private readonly logBox: any;
    private readonly footer: Widgets.BoxElement;

    private processes: ManagedProcess[] = [];
    private selectedIndex = 0;
    private refreshTimer?: NodeJS.Timeout;
    private statsTimer?: NodeJS.Timeout;
    private unsubscribeLogs?: () => void;
    private paused = false;
    private statusTimer?: NodeJS.Timeout;
    private cpuHistory: number[] = [];
    private memHistory: number[] = [];

    constructor(private readonly client = new PM2Client()) {
        this.screen = blessed.screen({
            smartCSR: true,
            title: "pm2x • Interactive Process Manager",
        });

        this.screen.key(["q", "C-c"], () => this.shutdown());
        this.screen.on("resize", () => {
            this.screen.render();
        });

        this.grid = new contrib.grid({
            rows: 12,
            cols: 12,
            screen: this.screen,
        });

        this.headerBox = this.grid.set(0, 0, 2, 12, blessed.box, {
            tags: true,
            padding: { top: 0, left: 1 },
            style: { fg: "white", bg: "blue" },
        });

        this.summaryBox = this.grid.set(2, 0, 2, 8, blessed.box, {
            label: "Cluster Overview",
            tags: true,
            border: { type: "line", fg: "cyan" },
            style: { bg: "", fg: "white" },
        });

        this.actionsBox = this.grid.set(2, 8, 2, 4, blessed.box, {
            label: "Quick Actions",
            tags: true,
            border: { type: "line", fg: "cyan" },
            style: { fg: "white" },
        });

        this.processTable = this.grid.set(4, 0, 5, 7, contrib.table, {
            keys: true,
            fg: "white",
            selectedFg: "black",
            selectedBg: "green",
            interactive: true,
            label: "Processes",
            columnWidth: [26, 12, 12, 16, 18, 12, 10],
        });

        this.detailBox = this.grid.set(4, 7, 3, 5, blessed.box, {
            label: "Selected Process",
            tags: true,
            border: { type: "line", fg: "cyan" },
        });

        this.statsBox = this.grid.set(7, 7, 2, 5, blessed.box, {
            label: "Host Metrics",
            tags: true,
            border: { type: "line", fg: "cyan" },
        });

        this.insightsBox = this.grid.set(9, 7, 2, 5, blessed.box, {
            label: "Insights",
            tags: true,
            border: { type: "line", fg: "cyan" },
            style: { fg: "white" },
        });

        this.logBox = this.grid.set(9, 0, 2, 7, contrib.log, {
            fg: "white",
            selectedFg: "green",
            label: "Live Logs",
            tags: true,
        });

        this.footer = this.grid.set(11, 0, 1, 12, blessed.box, {
            tags: true,
            border: { type: "line", fg: "cyan" },
        });

        this.registerKeybindings();
        this.updateActions();
        this.updateInsights();
    }

    async start(): Promise<void> {
        try {
            await this.client.ensureConnected();
        } catch (error) {
            this.flashError(
                `Unable to connect to PM2. Ensure PM2 is installed and running.\n${String(
                    error,
                )}`,
            );
            return;
        }

        await this.refreshProcesses(true);
        await this.subscribeToLogs();
        this.startAutoRefresh();
        this.startMetricsLoop();
        this.updateFooter();
        this.screen.render();
    }

    async shutdown(): Promise<void> {
        this.stopAutoRefresh();
        if (this.unsubscribeLogs) {
            this.unsubscribeLogs();
            this.unsubscribeLogs = undefined;
        }
        clearInterval(this.statsTimer as NodeJS.Timeout);
        await this.client.disconnect();
        this.screen.destroy();
        process.exit(0);
    }

    private registerKeybindings(): void {
        this.processTable.focus();
        const rows = this.processTable.rows;
        if (rows && typeof rows.on === "function") {
            rows.on("select", (_item: unknown, index: number) => {
                this.selectedIndex = index;
                this.afterSelectionChange();
                this.updateActions();
            });
        }

        this.screen.key(["up", "k"], () => this.changeSelection(-1));
        this.screen.key(["down", "j"], () => this.changeSelection(1));

        this.screen.key(["s"], () =>
            this.wrapAction("Starting all", () => this.client.startAll()),
        );
        this.screen.key(["r"], () =>
            this.wrapAction("Restarting all", () => this.client.restartAll()),
        );
        this.screen.key(["x"], () =>
            this.wrapAction("Stopping all", () => this.client.stopAll()),
        );
        this.screen.key(["S"], () =>
            this.wrapAction("Reloading all", () => this.client.reloadAll()),
        );
        this.screen.key(["l"], () => this.toggleLogsForSelected());
        this.screen.key([" "], () => {
            this.paused = !this.paused;
            if (this.paused) {
                this.stopAutoRefresh();
                this.flashInfo("Auto refresh paused");
            } else {
                this.startAutoRefresh();
                void this.refreshProcesses(true);
                this.flashInfo("Auto refresh resumed");
            }
            this.updateSummary();
            this.updateHeader();
            this.updateActions();
            this.updateFooter();
        });
        this.screen.key(["enter"], () => this.openActionMenu());
        this.screen.key(["?"], () => this.openHelpOverlay());
    }

    private async refreshProcesses(forceRender = false): Promise<void> {
        try {
            const processes = await this.client.listProcesses();
            this.processes = processes.sort((a, b) =>
                a.name.localeCompare(b.name),
            );
            this.renderProcessTable();
            this.updateSummary();
            this.updateDetailPanel();
            this.updateInsights();
            this.updateActions();
            this.updateHeader();
            if (forceRender) {
                this.screen.render();
            }
        } catch (error) {
            this.flashError(`Failed to refresh processes: ${String(error)}`);
        }
    }

    private renderProcessTable(): void {
        const headers = [
            "Process",
            "State",
            "Namespace",
            "CPU",
            "Memory",
            "Uptime",
            "Restarts",
        ];
        const data = this.processes.map((proc) => {
            const cpuValue = proc.cpu ?? 0;
            let cpuText = formatCpu(proc.cpu);
            if (proc.cpu !== undefined) {
                if (proc.cpu >= 80) cpuText = chalk.red(cpuText);
                else if (proc.cpu >= 50) cpuText = chalk.yellow(cpuText);
                else cpuText = chalk.green(cpuText);
            }
            const cpuCell =
                proc.cpu === undefined
                    ? "-"
                    : `${cpuText} ${this.renderMiniBar(cpuValue, 100, 6)}`;

            const memMb = proc.memory ? proc.memory / (1024 * 1024) : undefined;
            let memText = formatBytes(proc.memory);
            if (memMb !== undefined) {
                if (memMb >= 700) memText = chalk.red(memText);
                else if (memMb >= 400) memText = chalk.yellow(memText);
                else memText = chalk.cyan(memText);
            }
            const memoryCell =
                memMb === undefined
                    ? "-"
                    : `${memText} ${this.renderMiniBar(memMb, 1024, 6)}`;

            const restarts = proc.restarts ?? 0;
            let restartCell = restarts.toString();
            if (restarts >= 5) restartCell = chalk.red(restartCell);
            else if (restarts >= 1) restartCell = chalk.yellow(restartCell);

            let uptimeCell = formatUptime(proc.uptime);
            if (proc.uptime !== undefined) {
                if (proc.uptime < 5 * 60 * 1000 && proc.status === "online") {
                    uptimeCell = chalk.yellow(uptimeCell);
                } else if (proc.status === "online") {
                    uptimeCell = chalk.green(uptimeCell);
                }
            }

            return [
                this.decorateStatus(proc.status, proc.name),
                this.formatStatusBadge(proc.status),
                this.decorateNamespace(proc.namespace),
                cpuCell,
                memoryCell,
                uptimeCell,
                restartCell,
            ];
        });

        this.processTable.setData({ headers, data });

        if (data.length === 0) {
            this.selectedIndex = 0;
        } else {
            this.selectedIndex = Math.min(this.selectedIndex, data.length - 1);
            if (
                this.processTable.rows &&
                typeof this.processTable.rows.select === "function"
            ) {
                this.processTable.rows.select(this.selectedIndex);
            }
        }
    }

    private decorateStatus(status: string, name: string): string {
        const style = STATUS_STYLES[status] ?? {
            icon: "•",
            color: "white",
            label: status.toUpperCase(),
        };
        const colorize = getColor(style.color);
        return colorize(`${style.icon} ${name}`);
    }

    private decorateNamespace(namespace?: string): string {
        if (!namespace || namespace === "default") {
            return chalk.gray("default");
        }
        return chalk.cyan(namespace);
    }

    private formatStatusBadge(status: string): string {
        const style = STATUS_STYLES[status] ?? {
            icon: "•",
            color: "white",
            label: status.toUpperCase(),
        };
        const colorize = getColor(style.color);
        return colorize(`${style.icon} ${style.label}`);
    }

    private startAutoRefresh(): void {
        if (this.refreshTimer) return;
        this.refreshTimer = setInterval(() => {
            if (!this.paused) {
                void this.refreshProcesses();
            }
        }, REFRESH_INTERVAL_MS);
    }

    private stopAutoRefresh(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }

    private async subscribeToLogs(): Promise<void> {
        this.unsubscribeLogs = await this.client.launchBus(
            (message, proc) => {
                if (this.isSelectedProcess(proc.pm_id ?? -1, proc.name ?? "")) {
                    this.appendLog("out", proc.name ?? "?", message);
                }
            },
            (message, proc) => {
                if (this.isSelectedProcess(proc.pm_id ?? -1, proc.name ?? "")) {
                    this.appendLog("err", proc.name ?? "?", message);
                }
            },
        );
    }

    private appendLog(
        stream: "out" | "err",
        name: string,
        message: string,
    ): void {
        const prefix = stream === "out" ? chalk.gray("OUT") : chalk.red("ERR");
        this.logBox.log(`${prefix} ${chalk.bold(name)} ${message.trim()}`);
        this.screen.render();
    }

    private isSelectedProcess(pmId: number, name: string): boolean {
        const proc = this.processes[this.selectedIndex];
        if (!proc) return false;
        return proc.pmId === pmId || proc.name === name;
    }

    private async startMetricsLoop(): Promise<void> {
        await this.updateMetrics();
        this.statsTimer = setInterval(() => {
            void this.updateMetrics();
        }, STATS_INTERVAL_MS);
    }

    private async updateMetrics(): Promise<void> {
        try {
            const [load, memory] = await Promise.all([
                si.currentLoad(),
                si.mem(),
            ]);
            const cpu = Number(load.currentLoad.toFixed(1));
            const memUsed = memory.active ?? memory.used;
            const memPercent = Number(
                ((memUsed / memory.total) * 100).toFixed(1),
            );
            const loadAverages = load as unknown as {
                avgLoad?: number;
                avgload?: number;
            };
            const loadAvg = loadAverages.avgLoad ?? loadAverages.avgload ?? 0;
            this.trackHistory(this.cpuHistory, cpu);
            this.trackHistory(this.memHistory, memPercent);

            const cpuBar = this.renderBar(cpu);
            const memBar = this.renderBar(memPercent);
            const cpuTrend = this.renderTrend(this.cpuHistory);
            const memTrend = this.renderTrend(this.memHistory);

            const content = [
                `{cyan-fg}CPU{/cyan-fg}  ${cpu.toFixed(1)}%  ${cpuBar}`,
                `Trend ${cpuTrend}`,
                `{magenta-fg}MEM{/magenta-fg}  ${formatBytes(memUsed)} / ${formatBytes(
                    memory.total,
                )}  (${memPercent.toFixed(1)}%)  ${memBar}`,
                `Trend ${memTrend}`,
                `{white-fg}Load Avg{/white-fg}  ${loadAvg.toFixed(2)}  |  Procs ${
                    this.processes.length
                }`,
            ].join("\n");
            this.statsBox.setContent(content);
            this.screen.render();
        } catch (error) {
            this.statsBox.setContent(`Metrics unavailable\n${String(error)}`);
            this.screen.render();
        }
    }

    private trackHistory(history: number[], value: number): void {
        history.push(value);
        if (history.length > HISTORY_LENGTH) {
            history.shift();
        }
    }

    private toggleLogsForSelected(): void {
        const name = this.processes[this.selectedIndex]?.name ?? "—";
        this.logBox.setLabel(`Live Logs • ${name}`);
        this.logBox.setContent("");
        this.screen.render();
    }

    private getSelectedProcess(): ManagedProcess | undefined {
        return this.processes[this.selectedIndex];
    }

    private openActionMenu(): void {
        const proc = this.getSelectedProcess();
        if (!proc) {
            this.flashInfo("No process selected");
            return;
        }
        const resolveName = (p: ManagedProcess) =>
            p.name && p.name !== "unknown" ? p.name : String(p.pmId);
        const resolveId = (p: ManagedProcess) =>
            Number.isFinite(p.pmId) && p.pmId >= 0 ? p.pmId : resolveName(p);
        const actions: ActionDefinition[] = [
            {
                label: "Start",
                handler: (p) => this.client.startProcess(resolveName(p)),
            },
            {
                label: "Stop",
                handler: (p) => this.client.stopProcess(resolveId(p)),
            },
            {
                label: "Restart",
                handler: (p) => this.client.restartProcess(resolveId(p)),
            },
            {
                label: "Reload",
                handler: (p) => this.client.reloadProcess(resolveId(p)),
            },
            {
                label: "Delete",
                handler: (p) => this.client.deleteProcess(resolveId(p)),
                confirm: true,
            },
        ];

        const overlay = blessed.list({
            parent: this.screen,
            width: "30%",
            height: "50%",
            top: "center",
            left: "center",
            label: `Actions • ${proc.name}`,
            border: "line",
            keys: true,
            mouse: true,
            items: actions.map((action) => action.label),
            style: {
                selected: {
                    bg: "green",
                    fg: "black",
                },
            },
        });

        overlay.focus();
        overlay.on("select", async (_item: unknown, index: number) => {
            const action = actions[index];
            if (!action) return;
            if (action.confirm) {
                const confirmed = await this.confirm(
                    `${action.label} ${proc.name}? This cannot be undone.`,
                );
                if (!confirmed) {
                    this.screen.remove(overlay);
                    this.processTable.focus();
                    this.screen.render();
                    return;
                }
            }
            await this.wrapAction(`${action.label} ${proc.name}`, () =>
                action.handler(proc),
            );
            this.screen.remove(overlay);
            this.processTable.focus();
            void this.refreshProcesses(true);
        });

        overlay.key(["escape", "q"], () => {
            this.screen.remove(overlay);
            this.processTable.focus();
            this.screen.render();
        });

        this.screen.render();
    }

    private async confirm(message: string): Promise<boolean> {
        return new Promise((resolve) => {
            const box = blessed.box({
                parent: this.screen,
                width: "50%",
                height: "30%",
                top: "center",
                left: "center",
                label: "Confirm",
                border: "line",
                content: `${message}\n\nPress {green-fg}y{/green-fg} to confirm or any other key to cancel.`,
                tags: true,
                keys: true,
            });
            const cleanup = (result: boolean) => {
                this.screen.remove(box);
                this.processTable.focus();
                this.screen.render();
                resolve(result);
            };
            box.key(["y", "Y"], () => cleanup(true));
            box.key(["n", "N", "escape", "q", "enter"], () => cleanup(false));
            box.on("blur", () => cleanup(false));
            box.focus();
            this.screen.render();
        });
    }

    private async wrapAction(
        label: string,
        fn: () => Promise<void>,
    ): Promise<void> {
        try {
            this.flashInfo(`${label}…`);
            await fn();
            this.flashInfo(`${label} ✓`);
            void this.refreshProcesses(true);
        } catch (error) {
            this.flashError(`${label} failed: ${String(error)}`);
        }
    }

    private flashInfo(message: string): void {
        this.showStatusMessage(message, "green");
    }

    private flashError(message: string): void {
        this.showStatusMessage(message, "red");
    }

    private showStatusMessage(message: string, color: string): void {
        const statusLine = `{${color}-fg}${message}{/${color}-fg}`;
        this.footer.setContent(`${statusLine}\n${this.baseFooterContent()}`);
        this.screen.render();
        if (this.statusTimer) clearTimeout(this.statusTimer);
        this.statusTimer = setTimeout(() => this.updateFooter(), 3000);
    }

    private baseFooterContent(): string {
        return `↑↓ Navigate  Enter Actions  s Start all  r Restart all  x Stop all  S Reload all  l Clear logs  Space ${
            this.paused ? "Resume" : "Pause"
        }  ? Help  q Quit`;
    }

    private updateFooter(): void {
        this.footer.setContent(this.baseFooterContent());
        this.screen.render();
    }

    private changeSelection(offset: number): void {
        if (this.processes.length === 0) return;
        this.selectedIndex = Math.min(
            Math.max(this.selectedIndex + offset, 0),
            this.processes.length - 1,
        );
        if (
            this.processTable.rows &&
            typeof this.processTable.rows.select === "function"
        ) {
            this.processTable.rows.select(this.selectedIndex);
        }
        this.afterSelectionChange();
        this.updateActions();
    }

    private afterSelectionChange(): void {
        const name = this.processes[this.selectedIndex]?.name ?? "—";
        this.logBox.setLabel(`Live Logs • ${name}`);
        this.updateDetailPanel();
        this.updateInsights();
        this.screen.render();
    }

    private updateSummary(): void {
        const total = this.processes.length;
        const counters = {
            online: 0,
            stopped: 0,
            errored: 0,
            other: 0,
        };
        for (const proc of this.processes) {
            if (proc.status === "online") counters.online += 1;
            else if (proc.status === "stopped") counters.stopped += 1;
            else if (proc.status === "errored") counters.errored += 1;
            else counters.other += 1;
        }
        const mode = this.paused
            ? "{red-fg}PAUSED{/red-fg}"
            : "{green-fg}LIVE{/green-fg}";

        const topCpu = this.processes
            .filter((proc) => proc.cpu !== undefined)
            .sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0))[0];
        const topMem = this.processes
            .filter((proc) => proc.memory !== undefined)
            .sort((a, b) => (b.memory ?? 0) - (a.memory ?? 0))[0];
        const topRestarts = this.processes
            .filter((proc) => (proc.restarts ?? 0) > 0)
            .sort((a, b) => (b.restarts ?? 0) - (a.restarts ?? 0))[0];

        const cpuHotspot = topCpu
            ? `{cyan-fg}${topCpu.name}{/cyan-fg} ${formatCpu(topCpu.cpu)}`
            : "—";
        const memValueMb = topMem?.memory
            ? topMem.memory / (1024 * 1024)
            : undefined;
        const memColor = memValueMb && memValueMb > 700 ? "red" : "magenta";
        const memHotspot = topMem
            ? `{${memColor}-fg}${topMem.name}{/${memColor}-fg} ${formatBytes(
                  topMem.memory,
              )}`
            : "—";
        const restartHotspot = topRestarts
            ? `{magenta-fg}${topRestarts.name}{/magenta-fg} ${
                  topRestarts.restarts
              }`
            : "0";

        const headerLine = formatRow(
            [
                `{bold}${total} process${total === 1 ? "" : "es"}{/bold}`,
                `Mode ${mode}`,
                `Updated ${new Date().toLocaleTimeString()}`,
            ],
            [24, 16, 20],
        );

        const statusLine = formatRow(
            [
                `{green-fg}● Online{/green-fg} ${padNumber(counters.online)}`,
                `{yellow-fg}○ Stopped{/yellow-fg} ${padNumber(counters.stopped)}`,
                `{red-fg}✖ Errored{/red-fg} ${padNumber(counters.errored)}`,
                counters.other
                    ? `{magenta-fg}▲ Other{/magenta-fg} ${padNumber(counters.other)}`
                    : "",
            ].filter(Boolean),
            [24, 24, 24, 24],
        );

        const hotspotsLine = formatRow(
            [
                `{cyan-fg}CPU{/cyan-fg} ${cpuHotspot}`,
                `{magenta-fg}MEM{/magenta-fg} ${memHotspot}`,
                `{yellow-fg}Restarts{/yellow-fg} ${restartHotspot}`,
            ],
            [32, 32, 28],
        );

        const notices: string[] = [];
        if (counters.errored > 0) {
            notices.push(
                `{red-fg}!{/red-fg} ${counters.errored} process${
                    counters.errored === 1 ? "" : "es"
                } in error state`,
            );
        }
        if (counters.stopped > 0) {
            notices.push(
                `{yellow-fg}!{/yellow-fg} ${counters.stopped} stopped – consider cleanup or restart`,
            );
        }

        const contentLines = [headerLine, statusLine, hotspotsLine];
        if (notices.length > 0) {
            for (const notice of notices) {
                contentLines.push(formatRow([notice], [80]));
            }
        }

        this.summaryBox.setContent(contentLines.join("\n"));
    }

    private updateActions(): void {
        const proc = this.getSelectedProcess();
        const mode = this.paused
            ? "{red-fg}Paused Mode{/red-fg}"
            : "{green-fg}Live Mode{/green-fg}";
        const focus = proc
            ? `{cyan-fg}${proc.name}{/cyan-fg}`
            : "{gray-fg}No process selected{/gray-fg}";
        const lines = [
            mode,
            `Focus: ${focus}`,
            formatRow(
                [
                    `{green-fg}s{/green-fg} start all`,
                    `{yellow-fg}x{/yellow-fg} stop all`,
                ],
                [22, 22],
            ),
            formatRow(
                [
                    `{magenta-fg}r{/magenta-fg} restart all`,
                    `{cyan-fg}S{/cyan-fg} reload all`,
                ],
                [22, 22],
            ),
            formatRow(
                [
                    `{blue-fg}l{/blue-fg} clear logs`,
                    `{white-fg}?{/white-fg} help overlay`,
                ],
                [22, 22],
            ),
            `{cyan-fg}Enter{/cyan-fg} manage selected`,
        ];
        this.actionsBox.setContent(lines.join("\n"));
    }

    private updateDetailPanel(): void {
        const proc = this.getSelectedProcess();
        if (!proc) {
            this.detailBox.setLabel("Selected Process");
            this.detailBox.setContent("No PM2 processes found.");
            return;
        }
        this.detailBox.setLabel(
            `Details • ${proc.name} ${proc.pmId >= 0 ? `(#${proc.pmId})` : ""}`,
        );
        const lines = [
            `{bold}Status:{/bold} ${this.formatStatusBadge(proc.status)}`,
            `{bold}Namespace:{/bold} ${proc.namespace ?? "default"}`,
            `{bold}PID:{/bold} ${proc.pid ?? "-"}`,
            `{bold}Exec Mode:{/bold} ${proc.execMode ?? "-"}`,
            `{bold}Script:{/bold} ${proc.script ?? "-"}`,
            `{bold}CPU:{/bold} ${formatCpu(proc.cpu)}`,
            `{bold}Memory:{/bold} ${formatBytes(proc.memory)}`,
            `{bold}Uptime:{/bold} ${formatUptime(proc.uptime)}`,
            `{bold}Restarts:{/bold} ${proc.restarts ?? 0}`,
        ];
        this.detailBox.setContent(lines.join("\n"));
    }

    private updateInsights(): void {
        const total = this.processes.length;
        const offline = this.processes.filter(
            (proc) => proc.status !== "online",
        );
        const proc = this.getSelectedProcess();

        if (!proc) {
            const message =
                total === 0
                    ? "No PM2 processes detected.\nUse {green-fg}pm2 start app.js{/green-fg} to bootstrap and refresh."
                    : "Select a process to view health insights.";
            this.insightsBox.setLabel("Insights");
            this.insightsBox.setContent(message);
            return;
        }

        const bullet = (color: string, text: string) =>
            `{${color}-fg}●{/${color}-fg} ${text}`;

        const lines: string[] = [];

        if (proc.status === "online") {
            lines.push(
                bullet("green", `Running for ${formatUptime(proc.uptime)}.`),
            );
        } else if (proc.status === "stopped") {
            lines.push(
                bullet(
                    "yellow",
                    `Stopped. Press {cyan-fg}Enter{/cyan-fg} → Start or use {green-fg}s{/green-fg} to revive.`,
                ),
            );
        } else if (proc.status === "errored") {
            lines.push(
                bullet(
                    "red",
                    "Errored state – inspect logs (press l) and consider restart.",
                ),
            );
        } else {
            lines.push(bullet("magenta", `State: ${proc.status}`));
        }

        if (proc.cpu !== undefined) {
            if (proc.cpu >= 80) {
                lines.push(
                    bullet(
                        "red",
                        `High CPU at ${formatCpu(proc.cpu)} – investigate workload or scale.`,
                    ),
                );
            } else if (proc.cpu >= 50) {
                lines.push(
                    bullet(
                        "yellow",
                        `Sustained CPU ${formatCpu(proc.cpu)} – monitor for spikes.`,
                    ),
                );
            } else {
                lines.push(
                    bullet("gray", `CPU steady at ${formatCpu(proc.cpu)}.`),
                );
            }
        } else {
            lines.push(bullet("gray", "CPU metrics unavailable."));
        }

        if (proc.memory !== undefined) {
            const memMb = proc.memory / (1024 * 1024);
            if (memMb >= 700) {
                lines.push(
                    bullet(
                        "red",
                        `Memory ${memMb.toFixed(0)} MB – near 700+ MB. Check leaks or scale.`,
                    ),
                );
            } else if (memMb >= 400) {
                lines.push(
                    bullet(
                        "yellow",
                        `Memory ${memMb.toFixed(0)} MB – keep an eye on growth.`,
                    ),
                );
            } else {
                lines.push(bullet("gray", `Memory ${memMb.toFixed(0)} MB.`));
            }
        } else {
            lines.push(bullet("gray", "Memory metrics unavailable."));
        }

        const restarts = proc.restarts ?? 0;
        if (restarts >= 5) {
            lines.push(
                bullet(
                    "magenta",
                    `Restarted ${restarts} times – investigate crash loop or configure backoff.`,
                ),
            );
        } else if (restarts >= 1) {
            lines.push(
                bullet(
                    "yellow",
                    `Restarted ${restarts} time${restarts > 1 ? "s" : ""} since boot.`,
                ),
            );
        }

        const uptimeMs = proc.uptime ?? 0;
        if (uptimeMs > 0 && uptimeMs < 5 * 60 * 1000) {
            lines.push(
                bullet(
                    "cyan",
                    "Fresh deploy (<5m uptime) – validate stability.",
                ),
            );
        }

        const otherOffline = offline.filter((p) => p.pmId !== proc.pmId).length;
        if (otherOffline > 0) {
            lines.push(
                bullet(
                    "yellow",
                    `${otherOffline} other process${otherOffline === 1 ? "" : "es"} offline.`,
                ),
            );
        }

        if (lines.length === 0) {
            lines.push(bullet("green", "All checks look good."));
        }

        this.insightsBox.setLabel(`Insights • ${proc.name}`);
        this.insightsBox.setContent(lines.join("\n"));
    }

    private updateHeader(): void {
        const modeChip = this.paused
            ? chalk.black.bgYellow(" PAUSED ")
            : chalk.black.bgGreen(" LIVE ");
        const titleLine = `${chalk.black.bgCyan(" pm2x ")} ${chalk.white(
            "Interactive PM2 Control Deck",
        )}`;

        const statsLine = formatRow(
            [
                `${chalk.white(this.hostname)}`,
                `Processes ${padNumber(this.processes.length)}`,
                `Refreshed ${chalk.gray(new Date().toLocaleTimeString())}`,
                modeChip,
            ],
            [24, 18, 28, 14],
        );

        this.headerBox.setContent(`${titleLine}\n${statsLine}`);
    }

    private renderBar(value: number, max = 100, width = 20): string {
        const clamped = Math.max(0, Math.min(value / max, 1));
        const filled = Math.round(clamped * width);
        const empty = Math.max(width - filled, 0);
        return `${"#".repeat(filled)}${"-".repeat(empty)}`;
    }

    private renderMiniBar(value: number, max = 100, width = 6): string {
        if (!Number.isFinite(value) || max <= 0) return "";
        const clamped = Math.max(0, Math.min(value / max, 1));
        const filled = Math.round(clamped * width);
        const empty = Math.max(width - filled, 0);
        return `${"=".repeat(filled)}${".".repeat(empty)}`;
    }

    private renderTrend(history: number[]): string {
        if (history.length === 0) return "";
        const chars = " .:-=+*#%@";
        const max = 100;
        return history
            .slice(-Math.min(history.length, 40))
            .map((value) => {
                const normalized = Math.max(0, Math.min(value / max, 1));
                const index = Math.min(
                    chars.length - 1,
                    Math.round(normalized * (chars.length - 1)),
                );
                return chars[index];
            })
            .join("");
    }

    private openHelpOverlay(): void {
        const box = blessed.box({
            parent: this.screen,
            width: "60%",
            height: "70%",
            top: "center",
            left: "center",
            label: "Keyboard Shortcuts",
            border: "line",
            content: `
{bold}Navigation{/bold}
  ↑/↓ or j/k    Move selection
  Enter         Open action menu
  Space         Toggle auto refresh

{bold}Global Actions{/bold}
  s             Start all processes
  r             Restart all processes
  x             Stop all processes
  S             Reload all processes
  l             Clear log viewer

{bold}Misc{/bold}
  ?             Toggle this help
  q / Ctrl+C    Quit
`,
            tags: true,
            keys: true,
        });

        box.focus();
        const close = () => {
            this.screen.remove(box);
            this.processTable.focus();
            this.screen.render();
        };
        box.key(["escape", "q", "enter"], close);
        this.screen.render();
    }
}

function getColor(color: string): (value: string) => string {
    const map = chalk as unknown as Record<string, (value: string) => string>;
    return map[color] ?? ((value: string) => value);
}

const ANSI_REGEX = /\x1B\[[0-9;]*m/g;
const TAG_REGEX = /\{\/?[a-z0-9#-]+\}/gi;

function stripMarkup(value: string): string {
    return value.replace(ANSI_REGEX, "").replace(TAG_REGEX, "");
}

function padMarkup(value: string, width: number): string {
    if (width <= 0) return value;
    const visible = stripMarkup(value);
    const pad = Math.max(width - visible.length, 0);
    return `${value}${" ".repeat(pad)}`;
}

function formatRow(
    cells: string[],
    widths: number[],
    separator = "  ",
): string {
    return cells
        .map((cell, index) => {
            const width = widths[Math.min(index, widths.length - 1)] ?? 0;
            return padMarkup(cell, width);
        })
        .join(separator)
        .trimEnd();
}

function padNumber(value: number, width = 2): string {
    return String(value).padStart(width, " ");
}
