"use client";

import { useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { getFirebaseServices } from "../lib/firebase";

const timeSlots = [
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
];

type AppointmentStatus = "pendiente" | "atendido" | "cancelado";

type Appointment = {
  id: string;
  nombre: string;
  telefono: string;
  fecha: string;
  horario: string;
  aceptaPrivacidad: boolean;
  pacienteEmail: string;
  pacienteUid: string;
  estado: AppointmentStatus;
};

type StatusMessage = {
  text: string;
  type?: "success" | "error";
};

const today = new Date();
today.setHours(0, 0, 0, 0);
const todayInputValue = today.toISOString().split("T")[0];

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authStatus, setAuthStatus] = useState("No iniciaste sesion.");
  const [statusMessage, setStatusMessage] = useState<StatusMessage>({ text: "" });
  const [availabilityStatus, setAvailabilityStatus] = useState("Inicia sesion y elegi una fecha para ver horarios.");
  const [occupiedTimes, setOccupiedTimes] = useState<Set<string>>(new Set());
  const [adminAppointments, setAdminAppointments] = useState<Appointment[]>([]);
  const [myAppointments, setMyAppointments] = useState<Appointment[]>([]);
  const [adminStatus, setAdminStatus] = useState("");
  const [myAppointmentsStatus, setMyAppointmentsStatus] = useState("");
  const [adminDateFilter, setAdminDateFilter] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [formData, setFormData] = useState({
    nombre: "",
    telefono: "",
    fecha: "",
    horario: "",
    aceptaPrivacidad: false,
  });

  const filteredAdminAppointments = useMemo(() => {
    if (!adminDateFilter) {
      return adminAppointments;
    }

    return adminAppointments.filter((appointment) => appointment.fecha === adminDateFilter);
  }, [adminAppointments, adminDateFilter]);

  const hasPendingAppointment = myAppointments.some((appointment) => appointment.estado === "pendiente");

  useEffect(() => {
    try {
      const { auth } = getFirebaseServices();
      const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
        setUser(authUser);
        setOccupiedTimes(new Set());

        if (!authUser) {
          setIsAdmin(false);
          setAuthStatus("No iniciaste sesion.");
          setMyAppointments([]);
          setAdminAppointments([]);
          setAvailabilityStatus("Inicia sesion y elegi una fecha para ver horarios.");
          return;
        }

        setAuthStatus(`Sesion iniciada como ${authUser.email}`);
        const adminAccess = await checkAdmin(authUser.uid);
        setIsAdmin(adminAccess);
        await loadMyAppointments(authUser.uid);

        if (adminAccess) {
          await loadAdminAppointments();
        }
      });

      return unsubscribe;
    } catch (error) {
      console.error("Error de configuracion Firebase:", error);
      setAuthStatus("Falta configurar Firebase en Vercel.");
      setStatusMessage({
        text: "La pagina esta publicada, pero faltan variables de entorno de Firebase en Vercel.",
        type: "error",
      });
    }
  }, []);

  useEffect(() => {
    void loadAvailability();
  }, [formData.fecha, user]);

  async function handleLogin() {
    setStatusMessage({ text: "" });

    try {
      const { auth, googleProvider } = getFirebaseServices();
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Error al iniciar sesion:", error);
      setStatusMessage({ text: getAuthErrorMessage(error), type: "error" });
    }
  }

  async function handleLogout() {
    const { auth } = getFirebaseServices();
    await signOut(auth);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage({ text: "" });

    if (!user) {
      setStatusMessage({ text: "Inicia sesion con Google para reservar un turno.", type: "error" });
      return;
    }

    if (!formData.nombre || !formData.telefono || !formData.fecha || !formData.horario) {
      setStatusMessage({ text: "Completa todos los campos para reservar el turno.", type: "error" });
      return;
    }

    if (!formData.aceptaPrivacidad) {
      setStatusMessage({
        text: "Para reservar, confirma que aceptas el uso de tus datos para gestionar el turno.",
        type: "error",
      });
      return;
    }

    if (new Date(`${formData.fecha}T00:00:00`) < today) {
      setStatusMessage({ text: "La fecha del turno no puede ser anterior a hoy.", type: "error" });
      return;
    }

    if (occupiedTimes.has(formData.horario)) {
      setStatusMessage({ text: "Ese horario ya esta reservado. Elegi otro turno.", type: "error" });
      return;
    }

    if (hasPendingAppointment) {
      setStatusMessage({
        text: "Ya tenes un turno pendiente. Para elegir otro, primero cancela o modifica el turno actual.",
        type: "error",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { db } = getFirebaseServices();
      const appointmentId = `${formData.fecha}_${formData.horario}`;
      const batch = writeBatch(db);

      batch.set(doc(db, "turnosOcupados", appointmentId), {
        fecha: formData.fecha,
        horario: formData.horario,
        creadoEn: serverTimestamp(),
      });

      batch.set(doc(db, "turnos", appointmentId), {
        nombre: formData.nombre.trim(),
        telefono: formData.telefono.trim(),
        fecha: formData.fecha,
        horario: formData.horario,
        aceptaPrivacidad: formData.aceptaPrivacidad,
        pacienteEmail: user.email,
        pacienteUid: user.uid,
        estado: "pendiente",
        creadoEn: serverTimestamp(),
      });

      batch.set(doc(db, "userTurnosPendientes", user.uid), {
        turnoId: appointmentId,
        fecha: formData.fecha,
        horario: formData.horario,
        pacienteUid: user.uid,
        creadoEn: serverTimestamp(),
      });

      await batch.commit();

      setFormData({
        nombre: "",
        telefono: "",
        fecha: "",
        horario: "",
        aceptaPrivacidad: false,
      });
      setOccupiedTimes(new Set());
      setAvailabilityStatus("Elegi una fecha para ver horarios disponibles.");
      setStatusMessage({ text: "Turno reservado correctamente. Te esperamos.", type: "success" });
      await loadMyAppointments(user.uid);

      if (isAdmin) {
        await loadAdminAppointments();
      }
    } catch (error) {
      console.error("Error al reservar el turno:", error);
      setStatusMessage({ text: getFirestoreErrorMessage(error, "appointment"), type: "error" });
      await loadAvailability();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function loadAvailability() {
    setOccupiedTimes(new Set());

    if (!user || !formData.fecha) {
      setAvailabilityStatus(user ? "Elegi una fecha para ver horarios disponibles." : "Inicia sesion y elegi una fecha para ver horarios.");
      return;
    }

    setIsCheckingAvailability(true);
    setAvailabilityStatus("Consultando horarios...");

    try {
      const { db } = getFirebaseServices();
      const availabilityQuery = query(
        collection(db, "turnosOcupados"),
        where("fecha", "==", formData.fecha),
      );
      const snapshot = await getDocs(availabilityQuery);
      const occupied = new Set<string>();

      snapshot.forEach((documentSnapshot) => {
        occupied.add(documentSnapshot.data().horario);
      });

      setOccupiedTimes(occupied);
      const availableCount = timeSlots.filter((slot) => !occupied.has(slot)).length;
      setAvailabilityStatus(
        availableCount
          ? `${availableCount} horarios disponibles para esa fecha.`
          : "No quedan horarios disponibles para esa fecha.",
      );
    } catch (error) {
      console.error("Error al consultar disponibilidad:", error);
      setAvailabilityStatus(getFirestoreErrorMessage(error, "availability"));
    } finally {
      setIsCheckingAvailability(false);
    }
  }

  async function checkAdmin(uid: string) {
    try {
      const { db } = getFirebaseServices();
      const adminSnapshot = await getDoc(doc(db, "admins", uid));
      return adminSnapshot.exists() && adminSnapshot.data().activo === true;
    } catch (error) {
      console.error("Error al verificar administrador:", error);
      return false;
    }
  }

  async function loadMyAppointments(uid = user?.uid) {
    if (!uid) {
      return;
    }

    setMyAppointmentsStatus("Cargando tus turnos...");

    try {
      const { db } = getFirebaseServices();
      const myAppointmentsQuery = query(
        collection(db, "turnos"),
        where("pacienteUid", "==", uid),
      );
      const snapshot = await getDocs(myAppointmentsQuery);
      const appointments = snapshot.docs
        .map((documentSnapshot) => ({
          id: documentSnapshot.id,
          ...documentSnapshot.data(),
        })) as Appointment[];

      appointments.sort((a, b) => `${a.fecha} ${a.horario}`.localeCompare(`${b.fecha} ${b.horario}`));
      setMyAppointments(appointments);
      setMyAppointmentsStatus(`${appointments.length} turnos encontrados.`);
    } catch (error) {
      console.error("Error al cargar turnos del paciente:", error);
      setMyAppointmentsStatus(getFirestoreErrorMessage(error, "myAppointments"));
    }
  }

  async function loadAdminAppointments() {
    if (!isAdmin && !user) {
      return;
    }

    setAdminStatus("Cargando turnos...");

    try {
      const { db } = getFirebaseServices();
      const snapshot = await getDocs(collection(db, "turnos"));
      const appointments = snapshot.docs
        .map((documentSnapshot) => ({
          id: documentSnapshot.id,
          ...documentSnapshot.data(),
        })) as Appointment[];

      appointments.sort((a, b) => `${a.fecha} ${a.horario}`.localeCompare(`${b.fecha} ${b.horario}`));
      setAdminAppointments(appointments);
      setAdminStatus(`${appointments.length} turnos cargados.`);
    } catch (error) {
      console.error("Error al cargar turnos:", error);
      setAdminStatus(getFirestoreErrorMessage(error, "admin"));
    }
  }

  async function cancelOwnAppointment(appointment: Appointment, shouldPrefill: boolean) {
    if (!user) {
      return;
    }

    const confirmed = window.confirm(`Confirmar cancelacion del turno del ${appointment.fecha} a las ${appointment.horario}.`);

    if (!confirmed) {
      return;
    }

    setMyAppointmentsStatus("Actualizando tu turno...");

    try {
      const { db } = getFirebaseServices();
      const batch = writeBatch(db);
      const pendingAppointmentRef = doc(db, "userTurnosPendientes", user.uid);
      const pendingAppointmentSnapshot = await getDoc(pendingAppointmentRef);

      batch.update(doc(db, "turnos", appointment.id), {
        estado: "cancelado",
        actualizadoEn: serverTimestamp(),
      });
      batch.delete(doc(db, "turnosOcupados", appointment.id));

      if (pendingAppointmentSnapshot.exists()) {
        batch.delete(pendingAppointmentRef);
      }

      await batch.commit();
      await loadMyAppointments(user.uid);
      await loadAvailability();

      if (shouldPrefill) {
        setFormData({
          nombre: appointment.nombre,
          telefono: appointment.telefono,
          fecha: "",
          horario: "",
          aceptaPrivacidad: appointment.aceptaPrivacidad,
        });
        setStatusMessage({
          text: "Tu turno anterior fue cancelado. Elegi una nueva fecha y horario para completar la modificacion.",
          type: "success",
        });
        document.querySelector("#turnos")?.scrollIntoView({ behavior: "smooth" });
      }

      setMyAppointmentsStatus(shouldPrefill ? "Turno anterior cancelado. Ahora podes elegir uno nuevo." : "Turno cancelado correctamente.");
    } catch (error) {
      console.error("Error al cancelar turno del paciente:", error);
      setMyAppointmentsStatus(getFirestoreErrorMessage(error, "patientAction"));
    }
  }

  async function handleAdminAction(appointment: Appointment, action: "attended" | "cancel") {
    const actionLabel = action === "cancel" ? "cancelar" : "marcar como atendido";
    const confirmed = window.confirm(`Confirmar ${actionLabel} el turno de ${appointment.nombre} el ${appointment.fecha} a las ${appointment.horario}.`);

    if (!confirmed) {
      return;
    }

    setAdminStatus("Actualizando turno...");

    try {
      const { db } = getFirebaseServices();
      const batch = writeBatch(db);
      const appointmentRef = doc(db, "turnos", appointment.id);

      if (action === "cancel") {
        batch.update(appointmentRef, {
          estado: "cancelado",
          actualizadoEn: serverTimestamp(),
        });
        batch.delete(doc(db, "turnosOcupados", appointment.id));
        batch.delete(doc(db, "userTurnosPendientes", appointment.pacienteUid));
      } else {
        batch.update(appointmentRef, {
          estado: "atendido",
          actualizadoEn: serverTimestamp(),
        });
      }

      await batch.commit();
      await loadAdminAppointments();

      if (user?.uid === appointment.pacienteUid) {
        await loadMyAppointments(user.uid);
      }

      if (formData.fecha === appointment.fecha) {
        await loadAvailability();
      }

      setAdminStatus(action === "cancel" ? "Turno cancelado y horario liberado." : "Turno marcado como atendido.");
    } catch (error) {
      console.error("Error al actualizar turno:", error);
      setAdminStatus(getFirestoreErrorMessage(error, "adminAction"));
    }
  }

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#inicio" aria-label="Ir al inicio">
          <span className="brand-mark">SC</span>
          <span>Sonrisa Clara</span>
        </a>

        <nav className="main-nav" aria-label="Navegacion principal">
          <a href="#servicios">Servicios</a>
          <a href="#turnos">Turnos</a>
          {user && <a href="#misTurnos">Mis turnos</a>}
          {isAdmin && <a href="#adminPanel">Administracion</a>}
          <a href="#privacidad">Privacidad</a>
          <a href="#contacto">Contacto</a>
        </nav>
      </header>

      <main>
        <section className="hero" id="inicio">
          <div className="hero-content">
            <p className="eyebrow">Consultorio odontologico</p>
            <h1>Reserva tu turno en pocos pasos</h1>
            <p className="hero-copy">
              Atencion profesional para controles, limpiezas, blanqueamientos y urgencias odontologicas.
            </p>
            <a className="primary-link" href="#turnos">Sacar turno</a>
          </div>
        </section>

        <section className="services-section" id="servicios" aria-labelledby="servicios-titulo">
          <div className="section-heading">
            <p className="eyebrow">Tratamientos</p>
            <h2 id="servicios-titulo">Servicios principales</h2>
          </div>

          <div className="services-grid">
            <article className="service-card">
              <h3>Control odontologico</h3>
              <p>Revision general, diagnostico inicial y recomendaciones de cuidado.</p>
            </article>
            <article className="service-card">
              <h3>Limpieza dental</h3>
              <p>Profilaxis profesional para mantener en buen estado dientes y encias.</p>
            </article>
            <article className="service-card">
              <h3>Estetica dental</h3>
              <p>Opciones de blanqueamiento y restauraciones para mejorar tu sonrisa.</p>
            </article>
          </div>
        </section>

        <section className="appointment-section" id="turnos" aria-labelledby="turnos-titulo">
          <div className="appointment-copy">
            <p className="eyebrow">Turnos online</p>
            <h2 id="turnos-titulo">Elegir fecha y horario</h2>
            <p>Inicia sesion con Google para ver horarios disponibles y reservar tu turno.</p>
            <div className="auth-panel">
              <p>{authStatus}</p>
              <div className="auth-actions">
                {!user ? (
                  <button className="secondary-button" type="button" onClick={handleLogin}>Ingresar con Google</button>
                ) : (
                  <button className="secondary-button" type="button" onClick={handleLogout}>Cerrar sesion</button>
                )}
              </div>
            </div>
          </div>

          <form className="appointment-form" onSubmit={handleSubmit}>
            <label htmlFor="patientName">
              Nombre y apellido
              <input
                id="patientName"
                type="text"
                autoComplete="name"
                placeholder="Ej: Ana Perez"
                required
                disabled={!user}
                value={formData.nombre}
                onChange={(event) => setFormData((current) => ({ ...current, nombre: event.target.value }))}
              />
            </label>

            <label htmlFor="patientPhone">
              Telefono
              <input
                id="patientPhone"
                type="tel"
                autoComplete="tel"
                placeholder="Ej: 11 2345 6789"
                required
                disabled={!user}
                value={formData.telefono}
                onChange={(event) => setFormData((current) => ({ ...current, telefono: event.target.value }))}
              />
            </label>

            <label htmlFor="appointmentDate">
              Fecha
              <input
                id="appointmentDate"
                type="date"
                required
                min={todayInputValue}
                disabled={!user}
                value={formData.fecha}
                onChange={(event) => setFormData((current) => ({ ...current, fecha: event.target.value, horario: "" }))}
              />
            </label>

            <p className="availability-status">{availabilityStatus}</p>

            <label htmlFor="appointmentTime">
              Horario
              <select
                id="appointmentTime"
                required
                disabled={!user || isCheckingAvailability}
                value={formData.horario}
                onChange={(event) => setFormData((current) => ({ ...current, horario: event.target.value }))}
              >
                <option value="">Seleccionar horario</option>
                {timeSlots.map((slot) => {
                  const isOccupied = occupiedTimes.has(slot);
                  return (
                    <option key={slot} value={slot} disabled={isOccupied}>
                      {isOccupied ? `${slot} - No disponible` : slot}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="privacy-consent" htmlFor="privacyConsent">
              <input
                id="privacyConsent"
                type="checkbox"
                required
                disabled={!user}
                checked={formData.aceptaPrivacidad}
                onChange={(event) => setFormData((current) => ({ ...current, aceptaPrivacidad: event.target.checked }))}
              />
              Acepto que mis datos se usen para gestionar este turno.
            </label>

            <button type="submit" disabled={!user || isSubmitting || isCheckingAvailability}>
              {isSubmitting ? "Guardando..." : "Confirmar turno"}
            </button>
            <p className={`form-status ${statusMessage.type ? `is-${statusMessage.type}` : ""}`} role="status" aria-live="polite">
              {statusMessage.text}
            </p>
          </form>
        </section>

        {user && (
          <section className="my-appointments-section" id="misTurnos" aria-labelledby="mis-turnos-titulo">
            <div className="section-heading">
              <p className="eyebrow">Paciente</p>
              <h2 id="mis-turnos-titulo">Mis turnos</h2>
            </div>
            <p className="section-note">Podes cancelar tu turno pendiente o modificarlo cancelandolo primero y eligiendo una nueva fecha.</p>
            <div className="appointments-table-wrap">
              <table className="appointments-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Horario</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {myAppointments.length ? (
                    myAppointments.map((appointment) => (
                      <tr key={appointment.id}>
                        <td>{appointment.fecha}</td>
                        <td>{appointment.horario}</td>
                        <td><StatusBadge status={appointment.estado} /></td>
                        <td>
                          <div className="table-actions">
                            <button
                              className="table-action"
                              type="button"
                              disabled={appointment.estado !== "pendiente"}
                              onClick={() => cancelOwnAppointment(appointment, true)}
                            >
                              Modificar
                            </button>
                            <button
                              className="table-action danger"
                              type="button"
                              disabled={appointment.estado !== "pendiente"}
                              onClick={() => cancelOwnAppointment(appointment, false)}
                            >
                              Cancelar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={4}>Todavia no tenes turnos registrados.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="form-status" role="status" aria-live="polite">{myAppointmentsStatus}</p>
          </section>
        )}

        {isAdmin && (
          <section className="admin-section" id="adminPanel" aria-labelledby="admin-titulo">
            <div className="section-heading">
              <p className="eyebrow">Administracion</p>
              <h2 id="admin-titulo">Turnos reservados</h2>
            </div>
            <div className="admin-toolbar">
              <label className="admin-filter" htmlFor="adminDateFilter">
                Filtrar por fecha
                <input
                  id="adminDateFilter"
                  type="date"
                  value={adminDateFilter}
                  onChange={(event) => setAdminDateFilter(event.target.value)}
                />
              </label>
              <button className="secondary-button" type="button" onClick={() => setAdminDateFilter("")}>Ver todos</button>
              <button className="secondary-button" type="button" onClick={loadAdminAppointments}>Actualizar turnos</button>
              <p className="form-status" role="status" aria-live="polite">{adminStatus}</p>
            </div>
            <div className="appointments-table-wrap">
              <table className="appointments-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Horario</th>
                    <th>Paciente</th>
                    <th>Telefono</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAdminAppointments.length ? (
                    filteredAdminAppointments.map((appointment) => (
                      <tr key={appointment.id}>
                        <td>{appointment.fecha}</td>
                        <td>{appointment.horario}</td>
                        <td>{appointment.nombre}</td>
                        <td>{appointment.telefono}</td>
                        <td><StatusBadge status={appointment.estado} /></td>
                        <td>
                          <div className="table-actions">
                            <button
                              className="table-action"
                              type="button"
                              disabled={appointment.estado === "atendido" || appointment.estado === "cancelado"}
                              onClick={() => handleAdminAction(appointment, "attended")}
                            >
                              Atendido
                            </button>
                            <button
                              className="table-action danger"
                              type="button"
                              disabled={appointment.estado === "atendido" || appointment.estado === "cancelado"}
                              onClick={() => handleAdminAction(appointment, "cancel")}
                            >
                              Cancelar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={6}>No hay turnos para mostrar.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <PrivacySection />

        <section className="contact-section" id="contacto" aria-labelledby="contacto-titulo">
          <div>
            <p className="eyebrow">Contacto</p>
            <h2 id="contacto-titulo">Estamos en Buenos Aires</h2>
          </div>
          <p>Av. Salud Dental 1234 - Lunes a viernes de 9:00 a 18:00 - contacto@sonrisaclara.com</p>
        </section>
      </main>

      <footer className="site-footer">
        <p>Sonrisa Clara Consultorio Odontologico</p>
      </footer>
    </>
  );
}

function StatusBadge({ status }: { status: AppointmentStatus }) {
  const labels = {
    pendiente: "Pendiente",
    atendido: "Atendido",
    cancelado: "Cancelado",
  };

  return <span className={`status-badge status-${status}`}>{labels[status] || "Sin estado"}</span>;
}

function PrivacySection() {
  return (
    <section className="privacy-section" id="privacidad" aria-labelledby="privacidad-titulo">
      <div className="section-heading">
        <p className="eyebrow">Privacidad</p>
        <h2 id="privacidad-titulo">Politica de privacidad</h2>
      </div>
      <div className="privacy-grid">
        <article>
          <h3>Datos que guardamos</h3>
          <p>Nombre, telefono, email de la cuenta de Google, fecha y horario del turno.</p>
        </article>
        <article>
          <h3>Para que se usan</h3>
          <p>Se usan solamente para gestionar la reserva, identificar al paciente y contactar ante cambios del turno.</p>
        </article>
        <article>
          <h3>Quien puede verlos</h3>
          <p>Solo el personal administrativo autorizado puede ver los datos completos. Los pacientes solo ven horarios no disponibles.</p>
        </article>
        <article>
          <h3>Seguridad</h3>
          <p>El acceso se protege con inicio de sesion de Google, reglas de Firestore y App Check cuando esta activado.</p>
        </article>
      </div>
    </section>
  );
}

function getAuthErrorMessage(error: unknown) {
  const code = getErrorCode(error);
  const messages: Record<string, string> = {
    "auth/popup-closed-by-user": "Se cerro la ventana de Google antes de completar el ingreso.",
    "auth/popup-blocked": "El navegador bloqueo la ventana de Google. Permiti ventanas emergentes para este sitio.",
    "auth/unauthorized-domain": "Este dominio no esta autorizado en Firebase Authentication.",
  };

  return messages[code] || "No se pudo iniciar sesion. Intentalo nuevamente.";
}

function getFirestoreErrorMessage(error: unknown, context: string) {
  const code = getErrorCode(error);

  if (code === "permission-denied") {
    const messages: Record<string, string> = {
      appointment: "No se pudo reservar. El horario pudo haberse ocupado recien, ya tenes un turno pendiente o la sesion necesita volver a validarse.",
      availability: "No se pudo mostrar la disponibilidad. Inicia sesion nuevamente o revisa la configuracion de App Check.",
      admin: "No tenes permisos administrativos para ver los turnos.",
      adminAction: "No tenes permisos para modificar este turno.",
      myAppointments: "No se pudieron cargar tus turnos. Volve a iniciar sesion.",
      patientAction: "No se pudo cancelar el turno. Verifica que siga pendiente.",
    };

    return messages[context] || "No tenes permiso para realizar esta accion.";
  }

  if (code === "unavailable") {
    return "No hay conexion con Firebase en este momento. Proba de nuevo en unos minutos.";
  }

  return "Ocurrio un problema. Proba nuevamente.";
}

function getErrorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code?: unknown }).code);
  }

  return "";
}
