import { ChatPageClient } from "@/app/chat/ChatPageClient";

export default function PreviewPage() {
  return <ChatPageClient initialSessions={[]} user={{ userId: "preview", email: "preview@skychat.local", role: "user" }} preview />;
}
