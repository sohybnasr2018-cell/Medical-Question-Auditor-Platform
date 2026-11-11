/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    'pdf-parse',
    'pdfjs-dist',
    'tesseract.js',
    'exceljs'
  ],
  outputFileTracingIncludes: {
    '/**': [
      './src/lib/db/schema.sql',
      './eng.traineddata'
    ]
  }
};

export default nextConfig;
