**规则**

_blockedCommands_ 按命令名拦截，系统默认
const DEFAULT_BLOCKED_COMMANDS = [
"dd",
"diskutil",
"fdisk",
"halt",
"init",
"launchctl",
"mkfs",
"mkfs.apfs",
"mkfs.ext4",
"mkfs.xfs",
"parted",
"poweroff",
"reboot",
"sfdisk",
"shutdown",
"telinit"
];
_blockedSubstrings_ 按危险命令子串拦，系统默认
const DEFAULT_BLOCKED_SUBSTRINGS = [
"rm -rf /",
"rm -fr /",
"rm -rf /*",
"rm -fr /*",
"find / -delete",
":(){ :|:& };:"
];
**增加配置**
_openclaw.json中的配置项和系统默认项合集为黑名单_
{
"plugins": {
"allow": [
"high-risk-command-guard-plugin"
],
"entries": {
"high-risk-command-guard-plugin": {
"enabled": true,
"config": {
"blockedCommands": [
"dd",
],
"blockedSubstrings": [
"rm -rf /",

          ]
        }
      }
    }

}
}
