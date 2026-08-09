import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "./chatgpt-auth";
import { TogetherApp } from "./TogetherApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return (
    <TogetherApp
      user={user ? { displayName: user.displayName, email: user.email } : null}
      signInUrl={chatGPTSignInPath("/")}
      signOutUrl={chatGPTSignOutPath("/")}
    />
  );
}
