import { Tag } from "antd";

type StatusPillTone = "success" | "warning" | "danger" | "default";

type StatusPillProps = {
  tone?: StatusPillTone;
  children: string;
};

function toneToColor(tone: StatusPillTone): string | undefined {
  if (tone === "success") {
    return "green";
  }
  if (tone === "warning") {
    return "gold";
  }
  if (tone === "danger") {
    return "red";
  }
  return undefined;
}

export function StatusPill({ tone = "default", children }: StatusPillProps) {
  return <Tag color={toneToColor(tone)}>{children}</Tag>;
}
