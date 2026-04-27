import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_BASE_PATH } from "@/lib/basePath";
import NotFound from "@/pages/NotFound";
import { Route, Router as WouterRouter, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Admin from "./pages/Admin";
import AdminLogin from "./pages/AdminLogin";
import CustomerPortal from "./pages/CustomerPortal";
import CalendarRebuild from "./pages/CalendarRebuild";

function Router() {
  return (
    <WouterRouter base={APP_BASE_PATH}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/en" component={Home} />
        <Route path="/en/:rest*" component={Home} />
        <Route path="/admin/login" component={AdminLogin} />
        <Route path="/admin" component={Admin} />
        <Route path="/reservation" component={CalendarRebuild} />
        <Route path="/reservation/succes" component={CalendarRebuild} />
        <Route path="/reservation/annule" component={CalendarRebuild} />
        <Route path="/espace-client" component={CustomerPortal} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </WouterRouter>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
