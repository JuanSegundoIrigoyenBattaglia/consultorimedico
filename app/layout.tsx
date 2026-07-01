import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sonrisa Clara | Consultorio Odontologico",
  description: "Reserva de turnos online para consultorio odontologico.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
