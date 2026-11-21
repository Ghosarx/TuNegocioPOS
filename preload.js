const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  negocio: ipcRenderer.sendSync('negocio'),
  negocioGuardar: (data) => ipcRenderer.invoke('negocio-guardar', data),

  dbConfigGuardada: () => ipcRenderer.invoke('db-config-guardada'),
  dbConfigurar: (data) => ipcRenderer.invoke('db-configurar', data),
  adminInicialCrear: (data) => ipcRenderer.invoke('admin-inicial-crear', data),

  mesasPedidosListar: () => ipcRenderer.invoke('mesas-pedidos-listar'),
  mesasPedidoAgregar: (data) => ipcRenderer.invoke('mesas-pedido-agregar', data),
  mesasPedidoQuitar: (data) => ipcRenderer.invoke('mesas-pedido-quitar', data),

  login: (data) => ipcRenderer.invoke('login', data),
  logout: () => ipcRenderer.invoke('logout'),
  obtenerPreguntaSeguridad: (data) => ipcRenderer.invoke('obtener-pregunta-seguridad', data),
  recuperarPassword: (data) => ipcRenderer.invoke('recuperar-password', data),
  cambiarPasswordPropia: (data) => ipcRenderer.invoke('cambiar-password-propia', data),

  inventarioListar: () => ipcRenderer.invoke('inventario-listar'),
  inventarioAgregar: (data) => ipcRenderer.invoke('inventario-agregar', data),
  inventarioActualizar: (data) => ipcRenderer.invoke('inventario-actualizar', data),
  inventarioEliminar: (data) => ipcRenderer.invoke('inventario-eliminar', data),

  empleadosListar: () => ipcRenderer.invoke('empleados-listar'),
  empleadosCrear: (data) => ipcRenderer.invoke('empleados-crear', data),
  empleadosDesactivar: (data) => ipcRenderer.invoke('empleados-desactivar', data),
  empleadosReactivar: (data) => ipcRenderer.invoke('empleados-reactivar', data),
  empleadosCambiarPassword: (data) => ipcRenderer.invoke('empleados-cambiar-password', data),

  cajaAbrir: (data) => ipcRenderer.invoke('caja-abrir', data),
  cajaCerrar: (data) => ipcRenderer.invoke('caja-cerrar', data),
  cajaEstado: (data) => ipcRenderer.invoke('caja-estado', data),

  clientesListar: () => ipcRenderer.invoke('clientes-listar'),
  clientesCrear: (data) => ipcRenderer.invoke('clientes-crear', data),
  clienteBuscar: (data) => ipcRenderer.invoke('cliente-buscar', data),

  ventaRegistrar:(data) => ipcRenderer.invoke('venta-registrar', data),
  ventasDelDia: (data) => ipcRenderer.invoke('ventas-del-dia', data),
  ventasRecientesCaja: (data) => ipcRenderer.invoke('ventas-recientes-caja', data),
  ventaDevolver: (data) => ipcRenderer.invoke('venta-devolver', data),
  ventaDetalle: (data) => ipcRenderer.invoke('venta-detalle', data),

  configBoletaObtener: () => ipcRenderer.invoke('config-boleta-obtener'),
  configBoletaGuardar: (data) => ipcRenderer.invoke('config-boleta-guardar', data),

  insumosListar: () => ipcRenderer.invoke('insumos-listar'),
  recetasListar: () => ipcRenderer.invoke('recetas-listar'),
  insumosAgregar: (data) => ipcRenderer.invoke('insumos-agregar', data),
  insumosActualizar: (data) => ipcRenderer.invoke('insumos-actualizar', data),
  insumosAjustar: (data) => ipcRenderer.invoke('insumos-ajustar', data),
  insumosEliminar: (data) => ipcRenderer.invoke('insumos-eliminar', data),

  imprimirBoleta: (data) => ipcRenderer.invoke('imprimir-boleta', data),
  listarImpresoras: () => ipcRenderer.invoke('listar-impresoras'),

  refocusVentana: () => ipcRenderer.send('refocus-ventana'),
  salirApp: () => ipcRenderer.send('salir-app')
});
