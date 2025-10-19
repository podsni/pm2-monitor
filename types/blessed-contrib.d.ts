declare module "blessed-contrib" {
    import blessed = require("blessed");
    export interface TableOptions extends blessed.Widgets.BoxOptions {
        keys?: boolean;
        fg?: string;
        selectedFg?: string;
        selectedBg?: string;
        interactive?: boolean;
        columnWidth?: number[];
        label?: string;
    }

    export interface LogOptions extends blessed.Widgets.BoxOptions {
        fg?: string;
        selectedFg?: string;
        bufferLength?: number;
        label?: string;
        tags?: boolean;
    }

    export interface GridOptions {
        rows: number;
        cols: number;
        screen: blessed.Widgets.Screen;
    }

    export class Grid {
        constructor(options: GridOptions);
        set<T>(
            row: number,
            col: number,
            rowSpan: number,
            colSpan: number,
            widget: new (opts: any) => T,
            options?: any,
        ): T;
    }

    export class Table extends blessed.Widgets.ListTableElement {
        setData(data: { headers: string[]; data: string[][] }): void;
    }

    export class Log extends blessed.Widgets.Log {
        log(line: string): void;
    }

    export class Sparkline extends blessed.Widgets.BoxElement {
        setData(labels: string[], data: number[][]): void;
    }

    export const grid: {
        new (options: GridOptions): Grid;
    };
    export const table: typeof Table;
    export const log: typeof Log;
    export const sparkline: typeof Sparkline;

    export const widgets: {
        Table: typeof Table;
        Log: typeof Log;
        Sparkline: typeof Sparkline;
    };
}
