import { readConfig } from "@/lib/config";
import HomeClient from "./HomeClient";
import "./home.css";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const config = await readConfig();
  return <HomeClient initialConfig={config} />;
}
