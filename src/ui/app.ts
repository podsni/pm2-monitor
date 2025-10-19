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

const REFRESH_INTERVAL_MS = 2000; // Lebih cepat untuk interaktivitas
const STATS_INTERVAL_MS = 1500;
const HISTORY_LENGTH = 60; // Lebih banyak history untuk grafik
const NOTIFICATION_TIMEOUT = 3000;

const STATUS_STYLES: Record<
    string,
    { icon: string; color: string; label: string; bg?: string }
> = {
    online: { icon: "●", color: "green", label: "ONLINE", bg: "green" },
    stopped: { icon: "○", color: "yellow", label: "STOPPED", bg: "yellow" },
    errored: { icon: "✖", color: "red", label: "ERRORED", bg: "red" },
    stopping: { icon: "■", color: "magenta", label: "STOPPING", bg: "magenta" },
    launching: {
        icon: "▲",
        color: "cyan",
        label: "LAUNCHING",
        bg: "cyan",
    },
};

const THEMES = {
    primary: "cyan",
    success: "green",
    warning: "yellow",
    danger: "red",
    info: "blue",
    muted: "grey",
    accent: "magenta",
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
    private readonly notificationBox: Widgets.BoxElement;
    private readonly cpuLineChart: any;
    private readonly memLineChart: any;

    private processes: ManagedProcess[] = [];
    private selectedIndex = 0;
    private refreshTimer?: NodeJS.Timeout;
    private statsTimer?: NodeJS.Timeout;
    private unsubscribeLogs?: () => void;
    private paused = false;
    private statusTimer?: NodeJS.Timeout;
    private cpuHistory: number[] = [];
    private memHistory: number[] = [];
    private notificationTimer?: NodeJS.Timeout;
    private animationFrame = 0;
    private searchMode = false;
    private searchQuery = "";
    private filteredProcesses: ManagedProcess[] = [];
    private viewMode: "all" | "running" | "stopped" = "all";

    constructor(private readonly client = new PM2Client()) {
        this.screen = blessed.screen({
            smartCSR: true,
            title: "🚀 PM2X • Interactive Process Manager",
            fullUnicode: true,
            dockBorders: true,
            mouse: true,
            sendFocus: true,
        });

        this.screen.key(["q", "C-c"], () => this.shutdown());
        this.screen.on("resize", () => {
            this.screen.render();
        });

        // Enable mouse wheel scrolling globally
        this.screen.enableMouse();

        // Grid dengan layout yang lebih modern
        this.grid = new contrib.grid({
            rows: 16,
            cols: 12,
            screen: this.screen,
        });

        // Header dengan gradient effect
        this.headerBox = this.grid.set(0, 0, 2, 12, blessed.box, {
            tags: true,
            padding: { top: 0, left: 1, right: 1 },
            style: {
                fg: "white",
                bg: "blue",
                bold: true,
            },
        });

        // Notification box (hidden by default)
        this.notificationBox = blessed.box({
            top: "center",
            left: "center",
            width: "50%",
            height: 5,
            tags: true,
            border: {
                type: "line",
            },
            style: {
                fg: "white",
                bg: "black",
                border: { fg: THEMES.primary },
            },
            padding: 1,
            hidden: true,
        });
        this.screen.append(this.notificationBox);

        // Summary dengan warna yang lebih menarik
        this.summaryBox = this.grid.set(2, 0, 3, 6, blessed.box, {
            label: " 📊 Cluster Overview ",
            tags: true,
            border: { type: "line", fg: THEMES.primary },
            style: {
                bg: "",
                fg: "white",
                border: { fg: THEMES.primary },
                label: { fg: THEMES.accent, bold: true },
            },
            padding: { left: 1, right: 1 },
            mouse: true,
            scrollable: true,
        });

        // CPU Chart - use simple box instead of line chart for compatibility
        this.cpuLineChart = this.grid.set(2, 6, 3, 3, blessed.box, {
            label: " 📈 CPU Usage ",
            tags: true,
            border: { type: "line" },
            style: {
                fg: "white",
                border: { fg: THEMES.primary },
                label: { fg: THEMES.accent, bold: true },
            },
            padding: { left: 1 },
        });

        // Memory Chart - use simple box instead of line chart for compatibility
        this.memLineChart = this.grid.set(2, 9, 3, 3, blessed.box, {
            label: " 💾 Memory Usage ",
            tags: true,
            border: { type: "line" },
            style: {
                fg: "white",
                border: { fg: THEMES.primary },
                label: { fg: THEMES.accent, bold: true },
            },
            padding: { left: 1 },
        });

        // Actions dengan style lebih menarik
        this.actionsBox = this.grid.set(5, 0, 3, 4, blessed.box, {
            label: " ⚡ Quick Actions ",
            tags: true,
            border: { type: "line", fg: THEMES.primary },
            style: {
                fg: "white",
                border: { fg: THEMES.primary },
                label: { fg: THEMES.accent, bold: true },
            },
            padding: { left: 1 },
            mouse: true,
            scrollable: true,
        });

        // Process table dengan kolom yang lebih baik
        this.processTable = this.grid.set(5, 4, 6, 8, contrib.table, {
            keys: true,
            fg: "white",
            selectedFg: "black",
            selectedBg: THEMES.success,
            interactive: true,
            label: " 🔄 Processes ",
            columnWidth: [4, 20, 10, 10, 12, 10, 10, 10],
            columnSpacing: 1,
            style: {
                border: { fg: THEMES.primary },
                label: { fg: THEMES.accent, bold: true },
                header: { fg: THEMES.info, bold: true },
            },
            mouse: true,
            vi: true,
        });

        // Detail panel
        this.detailBox = this.grid.set(8, 0, 3, 4, blessed.box, {
            label: " 🔍 Process Details ",
            tags: true,
            border: { type: "line", fg: THEMES.primary },
            style: {
                border: { fg: THEMES.primary },
                label: { fg: THEMES.accent, bold: true },
            },
            padding: { left: 1 },
            scrollable: true,
            mouse: true,
        });

        // Stats box
        this.statsBox = this.grid.set(11, 0, 2, 4, blessed.box, {
            label: " 💻 System Stats ",
            tags: true,
            border: { type: "line", fg: THEMES.primary },
            style: {
                border: { fg: THEMES.primary },
                label: { fg: THEMES.accent, bold: true },
            },
            padding: { left: 1 },
            mouse: true,
        });

        // Insights dengan tips
        this.insightsBox = this.grid.set(13, 0, 2, 4, blessed.box, {
            label: " 💡 Insights ",
            tags: true,
            border: { type: "line", fg: THEMES.primary },
            style: {
                fg: "white",
                border: { fg: THEMES.primary },
                label: { fg: THEMES.accent, bold: true },
            },
            padding: { left: 1 },
            mouse: true,
            scrollable: true,
        });

        // Logs dengan warna syntax
        this.logBox = this.grid.set(11, 4, 4, 8, contrib.log, {
            fg: "white",
            selectedFg: THEMES.success,
            label: " 📝 Live Logs ",
            tags: true,
            style: {
                border: { fg: THEMES.primary },
                label: { fg: THEMES.accent, bold: true },
            },
            scrollable: true,
            mouse: true,
        });

        // Footer dengan lebih banyak shortcuts
        this.footer = this.grid.set(15, 0, 1, 12, blessed.box, {
            tags: true,
            border: { type: "line", fg: THEMES.primary },
            style: {
                fg: "white",
                border: { fg: THEMES.primary },
            },
            padding: { left: 1, right: 1 },
            mouse: true,
        });

        this.registerKeybindings();
        this.updateActions();
        this.updateInsights();
    }

    async start(): Promise<void> {
        this.showNotification("🚀 Connecting to PM2...", "info");
        try {
            await this.client.ensureConnected();
            this.showNotification(
                "✅ Connected to PM2 successfully!",
                "success",
            );
        } catch (error) {
            this.showNotification(
                `❌ Unable to connect to PM2\n${String(error)}`,
                "error",
            );
            return;
        }

        await this.refreshProcesses(true);
        await this.subscribeToLogs();
        this.startAutoRefresh();
        this.startMetricsLoop();
        this.updateFooter();
        this.startAnimation();
        this.screen.render();
    }

    async shutdown(): Promise<void> {
        this.showNotification("👋 Shutting down...", "info");
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

        // Mouse click support for process table
        this.processTable.on("click", () => {
            this.processTable.focus();
        });

        // Mouse wheel support for scrolling
        this.processTable.on("wheeldown", () => {
            this.changeSelection(1);
        });

        this.processTable.on("wheelup", () => {
            this.changeSelection(-1);
        });

        // Double click to open action menu
        this.processTable.on("element click", (_el: any, _data: any) => {
            const proc = this.getSelectedProcess();
            if (proc) {
                this.openActionMenu();
            }
        });

        // Make detail box scrollable with mouse
        this.detailBox.on("wheeldown", () => {
            this.detailBox.scroll(1);
            this.screen.render();
        });

        this.detailBox.on("wheelup", () => {
            this.detailBox.scroll(-1);
            this.screen.render();
        });

        // Make log box scrollable with mouse
        this.logBox.on("wheeldown", () => {
            this.logBox.scroll(1);
            this.screen.render();
        });

        this.logBox.on("wheelup", () => {
            this.logBox.scroll(-1);
            this.screen.render();
        });

        // Make insights scrollable with mouse
        this.insightsBox.on("wheeldown", () => {
            this.insightsBox.scroll(1);
            this.screen.render();
        });

        this.insightsBox.on("wheelup", () => {
            this.insightsBox.scroll(-1);
            this.screen.render();
        });

        // Navigation
        this.screen.key(["up", "k"], () => this.changeSelection(-1));
        this.screen.key(["down", "j"], () => this.changeSelection(1));
        this.screen.key(["g"], () => this.jumpToFirst());
        this.screen.key(["G"], () => this.jumpToLast());
        this.screen.key(["pageup"], () => this.changeSelection(-10));
        this.screen.key(["pagedown"], () => this.changeSelection(10));

        // Actions
        this.screen.key(["s"], () =>
            this.wrapAction("🚀 Starting all processes", () =>
                this.client.startAll(),
            ),
        );
        this.screen.key(["r"], () =>
            this.wrapAction("🔄 Restarting all processes", () =>
                this.client.restartAll(),
            ),
        );
        this.screen.key(["x"], () =>
            this.wrapAction("⏹️  Stopping all processes", () =>
                this.client.stopAll(),
            ),
        );
        this.screen.key(["S"], () =>
            this.wrapAction("♻️  Reloading all processes", () =>
                this.client.reloadAll(),
            ),
        );
        this.screen.key(["d"], async () => {
            const confirmed = await this.confirm(
                "Delete ALL processes? This cannot be undone!",
            );
            if (confirmed) {
                await this.wrapAction(
                    "🗑️  Deleting all processes",
                    async () => {
                        const procs = await this.client.listProcesses();
                        for (const proc of procs) {
                            await this.client.deleteProcess(proc.pmId);
                        }
                    },
                );
            }
        });

        // Individual process actions
        this.screen.key(["enter", "a"], () => this.openActionMenu());
        this.screen.key(["l"], () => this.toggleLogsForSelected());

        // View modes
        this.screen.key(["1"], () => this.setViewMode("all"));
        this.screen.key(["2"], () => this.setViewMode("running"));
        this.screen.key(["3"], () => this.setViewMode("stopped"));

        // Pause/Resume
        this.screen.key([" "], () => {
            this.paused = !this.paused;
            if (this.paused) {
                this.stopAutoRefresh();
                this.showNotification("⏸️  Monitoring paused", "warning");
            } else {
                this.startAutoRefresh();
                this.showNotification("▶️  Monitoring resumed", "success");
            }
            this.updateFooter();
            this.screen.render();
        });

        // Refresh
        this.screen.key(["f5", "R"], () => {
            this.showNotification("🔄 Refreshing...", "info");
            this.refreshProcesses(true);
        });

        // Search
        this.screen.key(["/"], () => this.startSearch());
        this.screen.key(["escape"], () => this.cancelSearch());

        // Help
        this.screen.key(["?", "h"], () => this.openHelpOverlay());
    }

    private startSearch(): void {
        this.searchMode = true;
        this.searchQuery = "";
        this.updateFooter();
        this.screen.render();

        // Simple search implementation
        const searchBox = blessed.textbox({
            parent: this.screen,
            top: "center",
            left: "center",
            width: "50%",
            height: 3,
            label: " 🔍 Search Process ",
            border: { type: "line" },
            style: {
                fg: "white",
                bg: "black",
                border: { fg: THEMES.primary },
            },
            inputOnFocus: true,
        });

        searchBox.on("submit", (value: string) => {
            this.searchQuery = value;
            this.applyFilter();
            searchBox.destroy();
            this.searchMode = false;
            this.updateFooter();
            this.screen.render();
        });

        searchBox.on("cancel", () => {
            searchBox.destroy();
            this.searchMode = false;
            this.updateFooter();
            this.screen.render();
        });

        this.screen.render();
        searchBox.focus();
        searchBox.readInput();
    }

    private cancelSearch(): void {
        this.searchMode = false;
        this.searchQuery = "";
        this.applyFilter();
        this.updateFooter();
        this.screen.render();
    }

    private applyFilter(): void {
        let filtered = this.processes;

        // Apply view mode filter
        if (this.viewMode === "running") {
            filtered = filtered.filter((p) => p.status === "online");
        } else if (this.viewMode === "stopped") {
            filtered = filtered.filter((p) => p.status !== "online");
        }

        // Apply search filter
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filtered = filtered.filter(
                (p) =>
                    p.name.toLowerCase().includes(query) ||
                    p.namespace?.toLowerCase().includes(query) ||
                    p.status.toLowerCase().includes(query),
            );
        }

        this.filteredProcesses = filtered;
        this.renderProcessTable();
    }

    private setViewMode(mode: "all" | "running" | "stopped"): void {
        this.viewMode = mode;
        this.applyFilter();
        const modeLabels = {
            all: "📋 All Processes",
            running: "✅ Running Only",
            stopped: "⏹️  Stopped Only",
        };
        this.showNotification(`View: ${modeLabels[mode]}`, "info");
        this.screen.render();
    }

    private jumpToFirst(): void {
        this.selectedIndex = 0;
        this.afterSelectionChange();
        this.screen.render();
    }

    private jumpToLast(): void {
        const procs = this.searchQuery
            ? this.filteredProcesses
            : this.processes;
        this.selectedIndex = Math.max(0, procs.length - 1);
        this.afterSelectionChange();
        this.screen.render();
    }

    private startAnimation(): void {
        setInterval(() => {
            this.animationFrame = (this.animationFrame + 1) % 4;
            this.updateHeader();
            this.screen.render();
        }, 250);
    }

    private showNotification(
        message: string,
        type: "info" | "success" | "warning" | "error",
    ): void {
        const icons = {
            info: "ℹ️",
            success: "✅",
            warning: "⚠️",
            error: "❌",
        };
        const colors = {
            info: THEMES.info,
            success: THEMES.success,
            warning: THEMES.warning,
            error: THEMES.danger,
        };

        if (this.notificationTimer) {
            clearTimeout(this.notificationTimer);
        }

        this.notificationBox.setContent(
            `{center}{bold}{${colors[type]}-fg}${icons[type]} ${message}{/${colors[type]}-fg}{/bold}{/center}`,
        );
        this.notificationBox.style.border.fg = colors[type];
        this.notificationBox.show();
        this.screen.render();

        this.notificationTimer = setTimeout(() => {
            this.notificationBox.hide();
            this.screen.render();
        }, NOTIFICATION_TIMEOUT);
    }

    private async refreshProcesses(force = false): Promise<void> {
        if (this.paused && !force) return;

        try {
            this.processes = await this.client.listProcesses();
            this.applyFilter();
            this.renderProcessTable();
            this.updateSummary();
            this.updateDetailPanel();
            this.updateInsights();
            this.screen.render();
        } catch (error) {
            this.showNotification(
                `Error refreshing: ${String(error)}`,
                "error",
            );
        }
    }

    private renderProcessTable(): void {
        const procs = this.searchQuery
            ? this.filteredProcesses
            : this.processes;

        const data = procs.map((p, idx) => {
            const style = STATUS_STYLES[p.status] || STATUS_STYLES.stopped;
            const isSelected = idx === this.selectedIndex;

            return [
                String(p.pmId),
                this.decorateName(p.name, isSelected),
                this.formatStatusBadge(p.status),
                this.decorateNamespace(p.namespace || "-"),
                formatUptime(p.uptime),
                formatCpu(p.cpu),
                formatBytes(p.memory),
                String(p.restarts),
            ];
        });

        this.processTable.setData({
            headers: [
                "ID",
                "Name",
                "Status",
                "Namespace",
                "Uptime",
                "CPU",
                "Memory",
                "Restarts",
            ],
            data,
        });
    }

    private decorateName(name: string, isSelected: boolean): string {
        if (isSelected) {
            return `{bold}{${THEMES.accent}-fg}▶ ${name}{/${THEMES.accent}-fg}{/bold}`;
        }
        return name;
    }

    private decorateStatus(status: string): string {
        const s = STATUS_STYLES[status];
        if (!s) return status;
        const colorFn = (chalk as any)[s.color];
        if (typeof colorFn === "function") {
            return colorFn(s.label);
        }
        return s.label;
    }

    private decorateNamespace(ns: string): string {
        return `{${THEMES.muted}-fg}${ns}{/${THEMES.muted}-fg}`;
    }

    private formatStatusBadge(status: string): string {
        const s = STATUS_STYLES[status];
        const color = s?.color || "white";
        const icon = s?.icon || "•";
        const label = s?.label || status.toUpperCase();
        return `{${color}-fg}${icon} ${label}{/${color}-fg}`;
    }

    private startAutoRefresh(): void {
        this.stopAutoRefresh();
        this.refreshTimer = setInterval(() => {
            void this.refreshProcesses();
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
                const pmId = proc.pm_id ?? -1;
                if (this.isSelectedProcess(pmId)) {
                    const name = proc.name ?? "unknown";
                    this.appendLog(name, message, false);
                }
            },
            (message, proc) => {
                const pmId = proc.pm_id ?? -1;
                if (this.isSelectedProcess(pmId)) {
                    const name = proc.name ?? "unknown";
                    this.appendLog(name, message, true);
                }
            },
        );
    }

    private appendLog(
        processName: string,
        data: string,
        isError: boolean,
    ): void {
        const timestamp = new Date().toLocaleTimeString();
        const color = isError ? THEMES.danger : THEMES.muted;
        const prefix = isError ? "ERR" : "OUT";
        this.logBox.log(
            `{${THEMES.muted}-fg}[${timestamp}]{/${THEMES.muted}-fg} {${color}-fg}[${prefix}]{/${color}-fg} {bold}${processName}{/bold}: ${data}`,
        );
    }

    private isSelectedProcess(pmId: number): boolean {
        const proc = this.getSelectedProcess();
        return proc?.pmId === pmId;
    }

    private async startMetricsLoop(): Promise<void> {
        await this.updateMetrics();
        this.statsTimer = setInterval(() => {
            void this.updateMetrics();
        }, STATS_INTERVAL_MS);
    }

    private async updateMetrics(): Promise<void> {
        try {
            const [cpuLoad, mem] = await Promise.all([
                si.currentLoad(),
                si.mem(),
            ]);

            const cpuPercent = Math.round(cpuLoad.currentLoad);
            const memPercent = Math.round((mem.used / mem.total) * 100);

            this.trackHistory(cpuPercent, memPercent);
            this.updateCharts();
            this.updateStatsBox(cpuPercent, memPercent, mem);
            this.screen.render();
        } catch (error) {
            // Silent fail for metrics
        }
    }

    private trackHistory(cpu: number, mem: number): void {
        this.cpuHistory.push(cpu);
        this.memHistory.push(mem);
        if (this.cpuHistory.length > HISTORY_LENGTH) {
            this.cpuHistory.shift();
            this.memHistory.shift();
        }
    }

    private updateCharts(): void {
        // Simple text-based charts for better compatibility
        const cpuAvg =
            this.cpuHistory.length > 0
                ? Math.round(
                      this.cpuHistory.reduce((a, b) => a + b, 0) /
                          this.cpuHistory.length,
                  )
                : 0;
        const memAvg =
            this.memHistory.length > 0
                ? Math.round(
                      this.memHistory.reduce((a, b) => a + b, 0) /
                          this.memHistory.length,
                  )
                : 0;

        const cpuTrend = this.renderTrend(this.cpuHistory);
        const memTrend = this.renderTrend(this.memHistory);

        const cpuBar = this.renderBar(cpuAvg, 30, THEMES.success);
        const memBar = this.renderBar(memAvg, 30, THEMES.info);

        this.cpuLineChart.setContent(
            [
                `{bold}Average:{/bold} ${cpuAvg}%`,
                cpuBar,
                `{${THEMES.muted}-fg}Trend: ${cpuTrend}{/${THEMES.muted}-fg}`,
            ].join("\n"),
        );

        this.memLineChart.setContent(
            [
                `{bold}Average:{/bold} ${memAvg}%`,
                memBar,
                `{${THEMES.muted}-fg}Trend: ${memTrend}{/${THEMES.muted}-fg}`,
            ].join("\n"),
        );
    }

    private renderTrend(history: number[]): string {
        if (history.length < 2) return "─".repeat(20);
        const chars = " ▁▂▃▄▅▆▇█";
        const max = Math.max(...history, 1);
        return history
            .slice(-20)
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

    private updateStatsBox(
        cpuPercent: number,
        memPercent: number,
        mem: any,
    ): void {
        const cpuBar = this.renderBar(cpuPercent, 20, THEMES.success);
        const memBar = this.renderBar(memPercent, 20, THEMES.info);

        this.statsBox.setContent(
            [
                `{bold}CPU:{/bold} ${cpuBar} ${cpuPercent}%`,
                `{bold}MEM:{/bold} ${memBar} ${memPercent}%`,
                `{${THEMES.muted}-fg}Used: ${formatBytes(mem.used)} / ${formatBytes(mem.total)}{/${THEMES.muted}-fg}`,
            ].join("\n"),
        );
    }

    private toggleLogsForSelected(): void {
        const proc = this.getSelectedProcess();
        if (proc) {
            this.showNotification(`📝 Showing logs for: ${proc.name}`, "info");
        }
    }

    private getSelectedProcess(): ManagedProcess | undefined {
        const procs = this.searchQuery
            ? this.filteredProcesses
            : this.processes;
        return procs[this.selectedIndex];
    }

    private async openActionMenu(): Promise<void> {
        const proc = this.getSelectedProcess();
        if (!proc) return;

        const actions: Record<string, ActionDefinition> = {
            "1": {
                label: "🚀 Start",
                handler: async (p) => this.client.startProcess(p.name),
            },
            "2": {
                label: "🔄 Restart",
                handler: async (p) => this.client.restartProcess(p.pmId),
            },
            "3": {
                label: "⏹️  Stop",
                handler: async (p) => this.client.stopProcess(p.pmId),
                confirm: true,
            },
            "4": {
                label: "♻️  Reload",
                handler: async (p) => this.client.reloadProcess(p.pmId),
            },
            "5": {
                label: "🗑️  Delete",
                handler: async (p) => this.client.deleteProcess(p.pmId),
                confirm: true,
            },
            "6": {
                label: "📊 Show Logs",
                handler: async (p) => {
                    this.showNotification(`Showing logs for ${p.name}`, "info");
                },
            },
        };

        const menuBox = blessed.list({
            parent: this.screen,
            top: "center",
            left: "center",
            width: "40%",
            height: "50%",
            label: ` ⚡ Actions for ${proc.name} `,
            tags: true,
            keys: true,
            vi: true,
            mouse: true,
            border: { type: "line" },
            style: {
                selected: {
                    bg: THEMES.success,
                    fg: "black",
                    bold: true,
                },
                border: { fg: THEMES.primary },
            },
            items: Object.values(actions).map((a) => a.label),
        });

        menuBox.on(
            "select",
            async (item: Widgets.BlessedElement, index: number) => {
                const keys = Object.keys(actions);
                const key = keys[index];
                if (!key) return;
                const action = actions[key];
                if (!action) return;
                menuBox.destroy();
                this.screen.render();

                if (action.confirm) {
                    const confirmed = await this.confirm(
                        `Are you sure you want to ${action.label.replace(/[^\w\s]/gi, "")} ${proc.name}?`,
                    );
                    if (!confirmed) return;
                }

                await this.wrapAction(`${action.label} ${proc.name}`, () =>
                    action.handler(proc),
                );
            },
        );

        menuBox.on("cancel", () => {
            menuBox.destroy();
            this.screen.render();
        });

        this.screen.render();
        menuBox.focus();
    }

    private async confirm(message: string): Promise<boolean> {
        return new Promise((resolve) => {
            const confirmBox = blessed.box({
                parent: this.screen,
                top: "center",
                left: "center",
                width: "50%",
                height: 7,
                label: " ⚠️  Confirmation ",
                tags: true,
                keys: true,
                border: { type: "line" },
                style: {
                    fg: "white",
                    bg: "black",
                },
                padding: 1,
                content: `${message}\n\nPress {green-fg}y{/green-fg} to confirm, {red-fg}n{/red-fg} to cancel`,
            });

            const cleanup = (result: boolean) => {
                confirmBox.destroy();
                this.screen.render();
                resolve(result);
            };

            confirmBox.key(["y", "Y"], () => cleanup(true));
            confirmBox.key(["n", "N", "escape", "q"], () => cleanup(false));
            confirmBox.focus();
            this.screen.render();
        });
    }

    private async wrapAction(
        description: string,
        action: () => Promise<void>,
    ): Promise<void> {
        try {
            this.showNotification(`⏳ ${description}...`, "info");
            await action();
            await this.refreshProcesses(true);
            this.showNotification(`✅ ${description} completed`, "success");
        } catch (error) {
            this.showNotification(`❌ Failed: ${String(error)}`, "error");
        }
    }

    private flashInfo(msg: string): void {
        this.showNotification(msg, "info");
    }

    private flashError(msg: string): void {
        this.showNotification(msg, "error");
    }

    private showStatusMessage(msg: string, duration = 2000): void {
        this.showNotification(msg, "info");
    }

    private baseFooterContent(): string {
        const spinners = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        const spinner = this.paused
            ? "⏸️ "
            : spinners[this.animationFrame % spinners.length];

        return `${spinner} {bold}PM2X Monitor{/bold} | {${THEMES.muted}-fg}${this.hostname}{/${THEMES.muted}-fg} | 🖱️  Mouse enabled`;
    }

    private updateFooter(): void {
        const base = this.baseFooterContent();
        const mode = this.paused ? "{yellow-fg}PAUSED{/yellow-fg}" : "";
        const view = this.viewMode !== "all" ? `View: ${this.viewMode}` : "";
        const search = this.searchQuery ? `🔍 "${this.searchQuery}"` : "";

        const shortcuts = [
            "{cyan-fg}?{/cyan-fg}=Help",
            "{cyan-fg}Click{/cyan-fg}=Select",
            "{cyan-fg}DblClick{/cyan-fg}=Actions",
            "{cyan-fg}Wheel{/cyan-fg}=Scroll",
            "{cyan-fg}Space{/cyan-fg}=Pause",
            "{cyan-fg}q{/cyan-fg}=Quit",
        ].join(" ");

        const parts = [base, mode, view, search, shortcuts]
            .filter(Boolean)
            .join(" | ");
        this.footer.setContent(parts);
    }

    private changeSelection(offset: number): void {
        const procs = this.searchQuery
            ? this.filteredProcesses
            : this.processes;
        if (procs.length === 0) return;

        this.selectedIndex = Math.max(
            0,
            Math.min(this.selectedIndex + offset, procs.length - 1),
        );
        this.afterSelectionChange();
    }

    private afterSelectionChange(): void {
        const proc = this.getSelectedProcess();
        if (proc) {
            this.logBox.setLabel(` 📝 Live Logs • ${proc.name} `);
            this.updateDetailPanel();
            this.updateInsights();
        }
        this.screen.render();
    }

    private updateSummary(): void {
        const total = this.processes.length;
        const online = this.processes.filter(
            (p) => p.status === "online",
        ).length;
        const stopped = this.processes.filter(
            (p) => p.status === "stopped",
        ).length;
        const errored = this.processes.filter(
            (p) => p.status === "errored",
        ).length;

        const totalCpu = this.processes.reduce(
            (sum, p) => sum + (p.cpu || 0),
            0,
        );
        const totalMem = this.processes.reduce(
            (sum, p) => sum + (p.memory || 0),
            0,
        );

        this.summaryBox.setContent(
            [
                `{bold}Total:{/bold} ${total} processes`,
                `{${THEMES.success}-fg}● Online:{/${THEMES.success}-fg} ${online}`,
                `{${THEMES.warning}-fg}○ Stopped:{/${THEMES.warning}-fg} ${stopped}`,
                `{${THEMES.danger}-fg}✖ Errored:{/${THEMES.danger}-fg} ${errored}`,
                ``,
                `{bold}Resources:{/bold}`,
                `CPU: ${totalCpu.toFixed(1)}%`,
                `Memory: ${formatBytes(totalMem)}`,
            ].join("\n"),
        );
    }

    private updateActions(): void {
        const proc = this.getSelectedProcess();
        const selected = proc
            ? `{${THEMES.accent}-fg}${proc.name}{/${THEMES.accent}-fg}`
            : "{${THEMES.muted}-fg}none{/${THEMES.muted}-fg}";

        this.actionsBox.setContent(
            [
                `{bold}Selected:{/bold} ${selected}`,
                ``,
                `{${THEMES.success}-fg}s{/${THEMES.success}-fg} Start all`,
                `{${THEMES.info}-fg}r{/${THEMES.info}-fg} Restart all`,
                `{${THEMES.warning}-fg}x{/${THEMES.warning}-fg} Stop all`,
                `{${THEMES.primary}-fg}S{/${THEMES.primary}-fg} Reload all`,
                `{${THEMES.danger}-fg}d{/${THEMES.danger}-fg} Delete all`,
                ``,
                `{${THEMES.accent}-fg}Enter{/${THEMES.accent}-fg} Process menu`,
            ].join("\n"),
        );
    }

    private updateDetailPanel(): void {
        const proc = this.getSelectedProcess();
        if (!proc) {
            this.detailBox.setContent("{center}No process selected{/center}");
            return;
        }

        const status = this.formatStatusBadge(proc.status);
        const cpuColor = (proc.cpu || 0) > 50 ? THEMES.danger : THEMES.success;
        const memMb = (proc.memory || 0) / (1024 * 1024);
        const memColor = memMb > 500 ? THEMES.danger : THEMES.info;

        this.detailBox.setContent(
            [
                `{bold}Name:{/bold} ${proc.name}`,
                `{bold}Status:{/bold} ${status}`,
                `{bold}PID:{/bold} ${proc.pid || "-"}`,
                `{bold}PM ID:{/bold} ${proc.pmId}`,
                `{bold}Namespace:{/bold} ${proc.namespace || "default"}`,
                ``,
                `{bold}CPU:{/bold} {${cpuColor}-fg}${formatCpu(proc.cpu)}{/${cpuColor}-fg}`,
                `{bold}Memory:{/bold} {${memColor}-fg}${formatBytes(proc.memory)}{/${memColor}-fg}`,
                `{bold}Uptime:{/bold} ${formatUptime(proc.uptime)}`,
                `{bold}Restarts:{/bold} ${proc.restarts || 0}`,
            ].join("\n"),
        );
    }

    private updateInsights(): void {
        const proc = this.getSelectedProcess();
        if (!proc) {
            this.insightsBox.setContent("{center}Select a process{/center}");
            return;
        }

        const insights: string[] = [];

        // CPU insights
        if ((proc.cpu || 0) > 80) {
            insights.push(
                `{${THEMES.danger}-fg}⚠{/${THEMES.danger}-fg} High CPU usage`,
            );
        } else if ((proc.cpu || 0) > 50) {
            insights.push(
                `{${THEMES.warning}-fg}⚠{/${THEMES.warning}-fg} Elevated CPU`,
            );
        }

        // Memory insights
        const memMb = (proc.memory || 0) / (1024 * 1024);
        if (memMb > 700) {
            insights.push(
                `{${THEMES.danger}-fg}⚠{/${THEMES.danger}-fg} High memory usage`,
            );
        } else if (memMb > 400) {
            insights.push(
                `{${THEMES.warning}-fg}⚠{/${THEMES.warning}-fg} Elevated memory`,
            );
        }

        // Restart insights
        if ((proc.restarts || 0) > 5) {
            insights.push(
                `{${THEMES.danger}-fg}⚠{/${THEMES.danger}-fg} Frequent restarts`,
            );
        }

        // Status insights
        if (proc.status === "errored") {
            insights.push(
                `{${THEMES.danger}-fg}✖{/${THEMES.danger}-fg} Process in error state`,
            );
        } else if (proc.status === "stopped") {
            insights.push(
                `{${THEMES.warning}-fg}○{/${THEMES.warning}-fg} Process is stopped`,
            );
        }

        if (insights.length === 0) {
            insights.push(
                `{${THEMES.success}-fg}✓{/${THEMES.success}-fg} All checks passed`,
            );
        }

        this.insightsBox.setContent(insights.join("\n"));
    }

    private updateHeader(): void {
        const now = new Date().toLocaleTimeString();
        const status = this.paused
            ? `{${THEMES.warning}-bg}{black-fg} PAUSED {/black-fg}{/${THEMES.warning}-bg}`
            : `{${THEMES.success}-bg}{black-fg} LIVE {/black-fg}{/${THEMES.success}-bg}`;

        this.headerBox.setContent(
            `{center}{bold}🚀 PM2X • Interactive Process Manager{/bold}\n{${THEMES.muted}-fg}Host: ${this.hostname} | Time: ${now} | ${status}{/${THEMES.muted}-fg}{/center}`,
        );
    }

    private renderBar(
        percent: number,
        width = 20,
        color = THEMES.primary,
    ): string {
        const filled = Math.round((percent / 100) * width);
        const empty = width - filled;
        const bar = "█".repeat(filled) + "░".repeat(empty);
        return `{${color}-fg}${bar}{/${color}-fg}`;
    }

    private openHelpOverlay(): void {
        const helpBox = blessed.box({
            parent: this.screen,
            top: "center",
            left: "center",
            width: "70%",
            height: "80%",
            label: " 📚 Help & Keyboard Shortcuts ",
            tags: true,
            keys: true,
            vi: true,
            mouse: true,
            scrollable: true,
            border: { type: "line" },
            style: {
                fg: "white",
                bg: "black",
                border: { fg: THEMES.primary },
                label: { fg: THEMES.accent, bold: true },
            },
            padding: 1,
        });

        helpBox.setContent(
            [
                "{bold}{center}PM2X Interactive Monitor{/center}{/bold}",
                "",
                "{bold}Navigation:{/bold}",
                "  {cyan-fg}↑/↓{/cyan-fg} or {cyan-fg}j/k{/cyan-fg}  Move selection up/down",
                "  {cyan-fg}g{/cyan-fg}              Jump to first process",
                "  {cyan-fg}G{/cyan-fg}              Jump to last process",
                "  {cyan-fg}PageUp/Down{/cyan-fg}    Scroll by 10 items",
                "",
                "{bold}Mouse Controls:{/bold}",
                "  {cyan-fg}Click{/cyan-fg}          Select process and focus panel",
                "  {cyan-fg}Double Click{/cyan-fg}   Open action menu for process",
                "  {cyan-fg}Scroll Wheel{/cyan-fg}   Navigate through processes/logs",
                "  {cyan-fg}Drag{/cyan-fg}           Scroll through content",
                "",
                "{bold}Process Actions:{/bold}",
                "  {cyan-fg}Enter{/cyan-fg} or {cyan-fg}a{/cyan-fg}    Open action menu for selected process",
                "  {cyan-fg}s{/cyan-fg}              Start all processes",
                "  {cyan-fg}r{/cyan-fg}              Restart all processes",
                "  {cyan-fg}x{/cyan-fg}              Stop all processes",
                "  {cyan-fg}S{/cyan-fg}              Reload all processes",
                "  {cyan-fg}d{/cyan-fg}              Delete all processes",
                "",
                "{bold}View Modes:{/bold}",
                "  {cyan-fg}1{/cyan-fg}              Show all processes",
                "  {cyan-fg}2{/cyan-fg}              Show only running processes",
                "  {cyan-fg}3{/cyan-fg}              Show only stopped processes",
                "",
                "{bold}Search & Filter:{/bold}",
                "  {cyan-fg}/{/cyan-fg}              Start search",
                "  {cyan-fg}Escape{/cyan-fg}         Cancel search",
                "",
                "{bold}Controls:{/bold}",
                "  {cyan-fg}Space{/cyan-fg}          Pause/Resume auto-refresh",
                "  {cyan-fg}F5{/cyan-fg} or {cyan-fg}R{/cyan-fg}      Force refresh",
                "  {cyan-fg}l{/cyan-fg}              Focus logs on selected process",
                "  {cyan-fg}?{/cyan-fg} or {cyan-fg}h{/cyan-fg}      Show this help",
                "  {cyan-fg}q{/cyan-fg} or {cyan-fg}Ctrl+C{/cyan-fg}  Quit application",
                "",
                "{bold}Tips:{/bold}",
                "  • Use arrow keys or vim-style navigation (j/k)",
                "  • Press Enter on a process to see available actions",
                "  • Monitor updates automatically every 2 seconds",
                "  • Charts show last 60 seconds of system metrics",
                "  • Use search (/) to quickly find processes",
                "",
                "{center}{grey-fg}Press any key to close this help{/grey-fg}{/center}",
            ].join("\n"),
        );

        helpBox.key(["escape", "q", "enter", "?", "h"], () => {
            helpBox.destroy();
            this.processTable.focus();
            this.screen.render();
        });

        this.screen.render();
        helpBox.focus();
    }
}

// Helper functions
function getColor(color: string): (value: string) => string {
    const map = chalk as unknown as Record<string, (value: string) => string>;
    return map[color] ?? ((value: string) => value);
}
