# 🚀 PM2X - Interactive PM2 Process Monitor

A beautiful, interactive terminal-based monitoring tool for PM2 processes with real-time metrics, charts, and intuitive controls.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Bun](https://img.shields.io/badge/runtime-Bun-orange)

## ✨ Features

- 🎨 **Beautiful Terminal UI** - Modern, colorful interface with intuitive layout
- 📊 **Real-time Charts** - Live CPU and Memory usage graphs
- 🔄 **Auto-refresh** - Updates every 2 seconds (configurable)
- 📝 **Live Logs** - Stream process logs in real-time
- 🔍 **Search & Filter** - Quickly find processes by name, namespace, or status
- ⚡ **Quick Actions** - Start, stop, restart, reload, or delete processes
- 💡 **Smart Insights** - Automatic warnings for high CPU, memory, or restarts
- ⌨️ **Keyboard Navigation** - Vim-style keys supported
- 🎯 **Multiple Views** - Filter by all/running/stopped processes
- 🌈 **Color-coded Status** - Easy to identify process states
- 🔔 **Notifications** - Visual feedback for actions
- 📈 **System Stats** - Host CPU and memory monitoring

## 📸 Screenshots

```
┌─────────────────────────────────────────────────────────────────────┐
│        🚀 PM2X • Interactive Process Manager                        │
│        Host: server-01 | Time: 14:30:45 | ● LIVE                   │
└─────────────────────────────────────────────────────────────────────┘

┌─ 📊 Cluster Overview ─────┬─ 📈 CPU Usage ──┬─ 💾 Memory Usage ───┐
│ Total: 5 processes         │                 │                     │
│ ● Online: 4                │     Chart       │      Chart          │
│ ○ Stopped: 1               │                 │                     │
│ ✖ Errored: 0              │                 │                     │
│                            │                 │                     │
│ Resources:                 │                 │                     │
│ CPU: 45.2%                 │                 │                     │
│ Memory: 2.3 GB             │                 │                     │
└────────────────────────────┴─────────────────┴─────────────────────┘

┌─ ⚡ Quick Actions ─────────┬─ 🔄 Processes ─────────────────────────┐
│ Selected: my-app           │ ID │ Name    │ Status  │ CPU  │ Mem  │
│                            │ 0  │▶ my-app │● ONLINE │ 5.2% │ 45MB │
│ s Start all                │ 1  │ api     │● ONLINE │ 8.1% │ 78MB │
│ r Restart all              │ 2  │ worker  │● ONLINE │ 12%  │ 120M │
│ x Stop all                 │ 3  │ bot     │○ STOPPED│ 0%   │ 0MB  │
│ S Reload all               │ 4  │ cron    │● ONLINE │ 1.5% │ 32MB │
│ d Delete all               └────────────────────────────────────────┘
│                            
│ Enter Process menu         ┌─ 📝 Live Logs • my-app ──────────────┐
└────────────────────────────│ [14:30:42] [OUT] Server started      │
                             │ [14:30:43] [OUT] Listening on :3000  │
┌─ 🔍 Process Details ───────│ [14:30:44] [OUT] Connected to DB    │
│ Name: my-app               └───────────────────────────────────────┘
│ Status: ● ONLINE           
│ PID: 12345                 
│ CPU: 5.2%                  
│ Memory: 45 MB              
│ Uptime: 2h 34m             
└────────────────────────────
```

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime installed
- PM2 installed and running
- Processes managed by PM2

### Installation

#### Option 1: One-Line Install (Recommended)
```bash
curl -fsSL https://raw.githubusercontent.com/yourusername/pm2x-monitor/main/install.sh | bash
```

#### Option 2: Manual Installation
```bash
# Clone the repository
git clone https://github.com/yourusername/pm2x-monitor.git
cd pm2x-monitor

# Install dependencies
bun install

# Run with wrapper script (recommended)
./pm2x

# Or run directly
bun run index.ts
```

### ⚠️ Important Note

**Compiled binaries in `dist/` folder will NOT work** due to a known limitation with Bun's bundler and the blessed module. 

**✅ Use one of these methods instead:**
- `./pm2x` - Wrapper script (best user experience)
- `bun run index.ts` - Direct execution
- `make start` - Using Makefile

## 🔨 Building (For Development)

**Note:** Due to blessed module limitations with Bun's compiler, standalone executables don't work. Use the wrapper script instead.

```bash
# Build bundles (for reference only)
chmod +x build.sh
./build.sh

# ⚠️ Compiled binaries won't run due to blessed module issue
# ✅ Use ./pm2x wrapper script instead
```

### Development Build

```bash
# Install dependencies
make install

# Run in development mode with hot reload
make dev

# Run normally
make start
```

## ⌨️ Keyboard Shortcuts

### Navigation
- `↑` / `↓` or `j` / `k` - Move selection up/down
- `g` - Jump to first process
- `G` - Jump to last process
- `PageUp` / `PageDown` - Scroll by 10 items

### Process Actions
- `Enter` or `a` - Open action menu for selected process
- `s` - Start all processes
- `r` - Restart all processes
- `x` - Stop all processes
- `S` (Shift+s) - Reload all processes
- `d` - Delete all processes

### View Modes
- `1` - Show all processes
- `2` - Show only running processes
- `3` - Show only stopped processes

### Search & Filter
- `/` - Start search
- `Escape` - Cancel search

### Controls
- `Space` - Pause/Resume auto-refresh
- `F5` or `R` (Shift+r) - Force refresh
- `l` - Focus logs on selected process
- `?` or `h` - Show help overlay
- `q` or `Ctrl+C` - Quit application

## 🎯 Process Actions Menu

Press `Enter` on any process to access:

1. 🚀 **Start** - Start the process
2. 🔄 **Restart** - Restart the process
3. ⏹️ **Stop** - Stop the process (with confirmation)
4. ♻️ **Reload** - Reload the process (zero-downtime)
5. 🗑️ **Delete** - Delete the process (with confirmation)
6. 📊 **Show Logs** - Focus on process logs

## 💡 Smart Insights

The monitor automatically detects and warns about:

- ⚠️ **High CPU Usage** - When process uses >50% CPU
- ⚠️ **High Memory Usage** - When process uses >400MB RAM
- ⚠️ **Frequent Restarts** - When restart count >5
- ⚠️ **Error State** - When process is in errored state
- ⚠️ **Stopped Processes** - Reminder about inactive processes

## 📊 Metrics & Charts

### Real-time Monitoring
- CPU usage per process
- Memory usage per process
- Process uptime
- Restart count
- Live status updates

### System Charts
- CPU usage history (60 seconds)
- Memory usage history (60 seconds)
- Visual bars and trend graphs

## 🎨 Color Coding

- 🟢 **Green** - Online/Running processes
- 🟡 **Yellow** - Stopped/Warning states
- 🔴 **Red** - Errored/Critical states
- 🔵 **Cyan** - Information/Actions
- 🟣 **Magenta** - Selected items/Accents

## 🔧 Configuration

You can modify constants in `src/ui/app.ts`:

```typescript
const REFRESH_INTERVAL_MS = 2000;  // Auto-refresh interval
const STATS_INTERVAL_MS = 1500;    // Stats update interval
const HISTORY_LENGTH = 60;         // Chart history length
const NOTIFICATION_TIMEOUT = 3000; // Notification display time
```

## 📁 Project Structure

```
pm2Monitor/
├── index.ts              # Entry point
├── src/
│   ├── services/
│   │   └── pm2Client.ts  # PM2 API wrapper
│   ├── ui/
│   │   └── app.ts        # Main UI application
│   └── utils/
│       └── format.ts     # Formatting utilities
├── build.sh              # Build script
├── package.json
├── tsconfig.json
└── README.md
```

## 🐛 Troubleshooting

### "Unable to connect to PM2"
- Ensure PM2 is installed: `npm install -g pm2`
- Check if PM2 daemon is running: `pm2 ls`
- Try: `pm2 update`

### "No processes found"
- Start some processes: `pm2 start app.js`
- Check PM2 list: `pm2 list`

### Charts not displaying
- Ensure terminal supports UTF-8
- Check terminal size (minimum 80x24 recommended)

### Build errors
- Ensure Bun is up to date: `bun upgrade`
- Clean and rebuild: `rm -rf node_modules && bun install`

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'feat: Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` - New features
- `fix:` - Bug fixes
- `chore:` - Maintenance tasks
- `docs:` - Documentation updates

## 📝 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Built with [Bun](https://bun.sh)
- Uses [blessed](https://github.com/chjj/blessed) for terminal UI
- Uses [blessed-contrib](https://github.com/yaronn/blessed-contrib) for charts
- Integrates with [PM2](https://pm2.keymetrics.io)

## 📞 Support

- 🐛 [Report a bug](https://github.com/yourusername/pm2x-monitor/issues)
- 💡 [Request a feature](https://github.com/yourusername/pm2x-monitor/issues)
- 📧 Email: your.email@example.com

## 🚀 Roadmap

- [ ] Fix compiled binary support (waiting for Bun update)
- [ ] Web dashboard interface
- [ ] Export metrics to file (JSON, CSV)
- [ ] Custom alert thresholds
- [ ] Process grouping
- [ ] Remote monitoring support
- [ ] Dark/Light theme toggle
- [ ] Plugin system
- [ ] Configuration file support

---

## 📝 Known Issues

### Compiled Binaries Don't Work
**Problem:** Running `./dist/pm2x-linux-x64` gives error: `Cannot find module './widgets/node'`

**Cause:** Blessed module uses dynamic imports that Bun's bundler cannot handle.

**Solution:** Use the wrapper script instead:
```bash
./pm2x        # ✅ Works perfectly
bun run index.ts  # ✅ Also works
./dist/pm2x-*     # ❌ Won't work
```

This is a known limitation and not a bug in PM2X Monitor. We're waiting for Bun to add support for this use case.

---

## 🤝 Support

- 💬 [Discussions](https://github.com/yourusername/pm2x-monitor/discussions)
- 🐛 [Report Bug](https://github.com/yourusername/pm2x-monitor/issues)
- 💡 [Request Feature](https://github.com/yourusername/pm2x-monitor/issues)

---

**Made with ❤️ using Bun**

*Star ⭐ this repo if you find it useful!*