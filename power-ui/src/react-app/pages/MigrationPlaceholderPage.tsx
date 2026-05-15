import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Card, Typography } from "antd";
import { Link } from "react-router-dom";

import { ROUTES } from "../router/paths";

const { Paragraph, Title } = Typography;

export type MigrationPlaceholderPageProps = {
  title: string;
  description?: string;
};

/**
 * Placeholder for sections that will be rebuilt in React; keeps shell navigation consistent.
 */
export function MigrationPlaceholderPage({ title, description }: MigrationPlaceholderPageProps) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-50 p-6">
      <Card className="w-full max-w-lg shadow-sm">
        <Title level={4} className="!mt-0">
          {title}
        </Title>
        <Paragraph type="secondary">
          {description ??
            "This area will be implemented in React while reusing `power-ui/src/adapters/` and shared domain modules."}
        </Paragraph>
        <Link to={ROUTES.root}>
          <Button type="primary" icon={<ArrowLeftOutlined />}>
            Back to workbench
          </Button>
        </Link>
      </Card>
    </div>
  );
}
