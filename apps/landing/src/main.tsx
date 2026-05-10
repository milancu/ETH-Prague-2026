import { StrictMode } from "react"
import ReactDOM from "react-dom/client"
import { ThemeProvider } from "@workspace/ui/components/theme-provider"
import App from "@/App"
import "@workspace/ui/globals.css"

const rootElement = document.getElementById("root")!
if (!rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(
    <StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </StrictMode>,
  )
}
