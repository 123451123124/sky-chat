export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  _count: { messages: number };
}

export interface ChatUser {
  userId: string;
  email: string;
  role: string;
}
