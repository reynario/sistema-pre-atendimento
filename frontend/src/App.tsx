import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Conversations from "./pages/Conversations";
import Chat from "./pages/Chat";
import Leads from "./pages/Leads";
import Agenda from "./pages/Agenda";
import Services from "./pages/Services";
import MinhaIA from "./pages/MinhaIA";
import Playground from "./pages/Playground";
import Notifications from "./pages/Notifications";
import Plan from "./pages/Plan";
import More from "./pages/More";
import Horarios from "./pages/Horarios";
import Reports from "./pages/Reports";
import Onboarding from "./pages/Onboarding";
import Team from "./pages/Team";
import AcceptInvite from "./pages/AcceptInvite";
import { Spinner } from "./components/ui";

function Protected({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/cadastro" element={<Register />} />
          <Route path="/convite/:token" element={<AcceptInvite />} />
          <Route
            path="/bem-vindo"
            element={
              <Protected>
                <Onboarding />
              </Protected>
            }
          />
          <Route
            element={
              <Protected>
                <Layout />
              </Protected>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/conversas" element={<Conversations />} />
            <Route path="/conversas/:id" element={<Chat />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/servicos" element={<Services />} />
            <Route path="/horarios" element={<Horarios />} />
            <Route path="/relatorios" element={<Reports />} />
            <Route path="/minha-ia" element={<MinhaIA />} />
            <Route path="/equipe" element={<Team />} />
            <Route path="/playground" element={<Playground />} />
            <Route path="/notificacoes" element={<Notifications />} />
            <Route path="/plano" element={<Plan />} />
            <Route path="/mais" element={<More />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
