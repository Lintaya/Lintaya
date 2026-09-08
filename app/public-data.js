// Data — Configuration constants only (no mock data)
// Generated arrays (HOSTS, VMS, etc.) are empty — real data comes from API

const VCENTERS = [
  { id: "vcenter", name: "VMware vCenter", region: "PRIMARY", site: "Primary data center" },
  { id: "vcenter-2", name: "VMware vCenter (secondary)", region: "SECONDARY", site: "Secondary data center" },
];

// HOSTS — empty, real data from /api/hosts-live
const HOSTS = [];

// VLANs (configuration)
const VLANS = [
  { id: 10,  name: "MGMT",     subnet: "10.10",   desc: "Management / out-of-band" },
  { id: 20,  name: "PROD-APP", subnet: "10.20",   desc: "Production apps" },
  { id: 30,  name: "PROD-DB",  subnet: "10.30",   desc: "Production databases" },
  { id: 40,  name: "QA",       subnet: "10.40",   desc: "QA / Staging" },
  { id: 50,  name: "DEV",      subnet: "10.50",   desc: "Development" },
  { id: 60,  name: "DMZ",      subnet: "172.16",  desc: "Public-facing services" },
  { id: 70,  name: "VOICE",    subnet: "10.70",   desc: "Telephony / SIP / RTP" },
  { id: 80,  name: "OSS-BSS",  subnet: "10.80",   desc: "OSS / BSS / provisioning" },
  { id: 90,  name: "MONITOR",  subnet: "10.90",   desc: "Monitoring & NOC" },
  { id: 100, name: "BACKUP",   subnet: "10.100",  desc: "Backup / replication" },
];

// VMS — empty, real data from /api/vms-live
const VMS = [];

// Passwords — empty, real data from Bitwarden vault
const PASSWORDS = [];

// Team — empty, real data from API
const DEVS = [];

// Global Tags (configuration)
const TAGS = [
  // Default set: the tags an install needs before it has any of its own.
  { id: "connection", label: "Connection", color: "#0ea5e9",
    description: "Access protocol used to connect to this resource",
    values: [
      { id: "conn-ssh",    label: "SSH" },
      { id: "conn-rdp",    label: "RDP" },
      { id: "conn-https",  label: "HTTPS" },
      { id: "conn-telnet", label: "Telnet" },
    ]},
  { id: "environment", label: "Environment", color: "#10b981",
    description: "Deployment stage this resource belongs to",
    values: [
      { id: "env-prod",    label: "Prod" },
      { id: "env-staging", label: "Staging" },
      { id: "env-dev",     label: "Dev" },
      { id: "env-lab",     label: "Lab" },
    ]},
  { id: "criticality", label: "Criticality", color: "#64748b",
    description: "How much impact an outage or issue here would have",
    values: [
      { id: "crit-critical", label: "Critical" },
      { id: "crit-high",     label: "High" },
      { id: "crit-medium",   label: "Medium" },
      { id: "crit-low",      label: "Low" },
    ]},
  { id: "ownership", label: "Ownership", color: "#7c3aed",
    description: "Who is responsible for this resource",
    values: [
      { id: "owner-infra",    label: "Infra" },
      { id: "owner-network",  label: "Network" },
      { id: "owner-security", label: "Security" },
      { id: "owner-personal", label: "Personal" },
    ]},
  // Device type lives here rather than in a hardcoded DEVICE_KINDS list, so an
  // install names its own kinds without touching the code.
  { id: "device-type", label: "Device Type", color: "#0891b2",
    description: "What kind of equipment this is",
    values: [
      { id: "switch-core",   label: "Core Switch" },
      { id: "switch-access", label: "Access Switch" },
      { id: "router",        label: "Router" },
      { id: "firewall",      label: "Firewall" },
      { id: "wlc",           label: "WLAN Ctrl" },
      { id: "loadbalancer",  label: "Load Balancer" },
      { id: "server",        label: "Server" },
      { id: "storage",       label: "Storage" },
      { id: "ups",           label: "UPS" },
      { id: "other",         label: "Other" },
    ]},
];

// Network Devices
const DEVICES = [];

// App categories (configuration)
const APPS = [];

// Mail / Calendar — empty, real data from Outlook connector
const MEETINGS = [];

// Snippets (configuration)
const SNIPPETS = [
  { id: 1,  title: "Restart nginx + verify",        lang: "bash", body: "sudo systemctl restart nginx && sudo systemctl status nginx --no-pager" },
  { id: 2,  title: "Last 200 lines of app log",     lang: "bash", body: "sudo journalctl -u app.service -n 200 --no-pager" },
  { id: 3,  title: "Disk space by folder",          lang: "bash", body: "sudo du -h --max-depth=1 /var | sort -hr | head -20" },
  { id: 4,  title: "Top processes by RAM",          lang: "bash", body: "ps aux --sort=-%mem | head -15" },
  { id: 5,  title: "Backup nginx config",           lang: "bash", body: "sudo tar -czf /backup/nginx-$(date +%F).tar.gz /etc/nginx" },
  { id: 6,  title: "Postgres active connections",   lang: "sql",  body: "SELECT pid, usename, client_addr, state, query_start, query FROM pg_stat_activity WHERE state <> 'idle' ORDER BY query_start;" },
  { id: 7,  title: "Postgres top 10 table sizes",   lang: "sql",  body: "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;" },
  { id: 8,  title: "Get-VM in PowerCLI",            lang: "ps1",  body: "Get-VM | Select Name,PowerState,NumCpu,MemoryGB,@{N='Host';E={$_.VMHost.Name}} | Sort Name | Format-Table -AutoSize" },
  { id: 9,  title: "VMs by VLAN (PowerCLI)",        lang: "ps1",  body: "Get-VM | Get-NetworkAdapter | Select @{N='VM';E={$_.Parent.Name}}, NetworkName | Sort NetworkName | Format-Table -AutoSize" },
  { id: 10, title: "ESXi hosts CPU usage",          lang: "ps1",  body: "Get-VMHost | Select Name, @{N='CPU%';E={[math]::Round(($_.CpuUsageMhz/$_.CpuTotalMhz)*100,1)}}, Version | Sort 'CPU%' -Desc" },
];

// Connectors — empty, real data from /api/connectors/status
const CONNECTORS = [];

window.APP_DATA = { VCENTERS, HOSTS, VLANS, VMS, PASSWORDS, APPS, CONNECTORS, MEETINGS, DEVS, SNIPPETS, TAGS, DEVICES };
