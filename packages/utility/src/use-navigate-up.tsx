import { useEffect } from "react"

export interface NavigateUpOptions {
  getParentPath: () => string | null
  navigate: (path: string) => void
}

export function useNavigateUp({ getParentPath, navigate }: NavigateUpOptions): void {
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (e.button === 3 && e.ctrlKey) {
        e.preventDefault()
        const parent = getParentPath()
        if (parent) navigate(parent)
      }
    }

    window.addEventListener("mousedown", handleMouseDown)
    return () => window.removeEventListener("mousedown", handleMouseDown)
  }, [getParentPath, navigate])
}
