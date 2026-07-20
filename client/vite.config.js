import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // El motor líquido queda aislado y se descarga en segundo plano cuando el navegador está libre.
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('react-dom') || id.includes('react/') || id.includes('scheduler')) {
            return 'vendor-react'
          }
          if (id.includes('bootstrap') || id.includes('react-icons')) {
            return 'vendor-ui'
          }
          if (id.includes('axios')) {
            return 'vendor-data'
          }
          if (id.includes('react-to-print')) {
            return 'vendor-print'
          }
        },
      },
    },
  },
})
