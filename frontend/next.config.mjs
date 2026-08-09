import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.resolve('..'),
  async rewrites() {
    const configuredBackendUrl = process.env.BACKEND_INTERNAL_URL || 'localhost:5000';
    const backendUrl = configuredBackendUrl.startsWith('http')
      ? configuredBackendUrl
      : `http://${configuredBackendUrl}`;

    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
};

export default nextConfig;
