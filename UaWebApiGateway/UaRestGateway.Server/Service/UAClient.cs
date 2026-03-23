using Opc.Ua;
using Opc.Ua.Client;
using Opc.Ua.Configuration;
using Opc.Ua.Server;
using System.Reflection;
using ISession = Opc.Ua.Client.ISession;
using StatusCodes = Opc.Ua.StatusCodes;

namespace UaRestGateway.Server.Service
{
    public class UAClient : IDisposable
    {
        #region Private Fields
        private readonly object m_lock = new();
        private readonly ApplicationConfiguration m_configuration;
        private SessionReconnectHandler m_reconnectHandler;
        private ISession m_session;
        private readonly ILogger m_logger;
        private readonly UAClientSettings m_settings;
        #endregion

        #region Constructors
        public UAClient(ILogger logger, ApplicationConfiguration configuration, UAClientSettings settings)
        {
            m_configuration = configuration;
            m_settings = settings;
            m_logger = logger;
            m_configuration.CertificateValidator.CertificateValidation += CertificateValidation;
        }

        public UAClient()
        {
            //ToDo use with Client
            InitializeAsync().GetAwaiter().GetResult();
        }

        private async Task InitializeAsync()
        {
            Console.WriteLine("UAClient created");

            string password = null;
            var applicationName = "ConsoleReferenceClient";
            var configSectionName = "Quickstarts.ReferenceClient";

            //Change Server URL
            Uri serverUrl = new Uri("opc.tcp://192.168.56.102:4840");

            CertificatePasswordProvider PasswordProvider = new CertificatePasswordProvider(password);
            ApplicationInstance application = new ApplicationInstance
            {
                ApplicationName = applicationName,
                ApplicationType = ApplicationType.Client,
                ConfigSectionName = configSectionName,
                CertificatePasswordProvider = PasswordProvider
            };

            var config = await application.LoadApplicationConfigurationAsync(silent: false).ConfigureAwait(false);

            config.TraceConfiguration.ApplySettings();


            bool haveAppCertificate = await application.CheckApplicationInstanceCertificatesAsync(false);
            if (!haveAppCertificate)
            {
                throw new Exception("Application instance certificate invalid!");
            }

            // Create a session with the server
            var endpointDescription = CoreClientUtils.SelectEndpoint(config, serverUrl.ToString(), useSecurity: false);
            var endpointConfiguration = EndpointConfiguration.Create(config);
            var endpoint = new ConfiguredEndpoint(null, endpointDescription, endpointConfiguration);

            m_session = await Opc.Ua.Client.Session.Create(config, endpoint, false, applicationName, 60000, new UserIdentity(new AnonymousIdentityToken()), null);
            Console.WriteLine("Session is activated with intial ID: " + m_session.SessionId);
            Console.WriteLine("Created Session on " + serverUrl);
        }
        #endregion

        #region IDisposable
        public void Dispose()
        {
            Utils.SilentDispose(m_session);
            m_configuration.CertificateValidator.CertificateValidation -= CertificateValidation;
            GC.SuppressFinalize(this);
        }
        #endregion

        #region Public Properties
        /// <summary>
        /// Gets the client session.
        /// </summary>
        public ISession Session => m_session;

        /// <summary>
        /// The reconnect period to be used in ms.
        /// </summary>
        public int ReconnectPeriod { get; set; } = 5000;

        /// <summary>
        /// The reconnect period exponential backoff to be used in ms.
        /// </summary>
        public int ReconnectPeriodExponentialBackoff { get; set; } = 15000;
        #endregion

        public static async Task<UAClient> Run(
            ILogger logger,
            UAClientSettings settings,
            CancellationToken ct)
        {
            try
            {
                var application = new ApplicationInstance
                {
                    ApplicationName = "I4AAS OPC UA Gateway",
                    ApplicationType = ApplicationType.Client
                };

                string folder = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                var configurationFile = Path.Combine(folder, "config", "uaserver-configuration.xml");

                // load the application configuration.
                var configuration = await application.LoadApplicationConfigurationAsync(configurationFile, false).ConfigureAwait(false);

                // check the application certificate.
                bool haveAppCertificate = await application
                    .CheckApplicationInstanceCertificatesAsync(false)
                    .ConfigureAwait(false);

                if (!haveAppCertificate)
                {
                    throw new InvalidOperationException("Application instance certificate invalid!");
                }

                var uaClient = new UAClient(logger, configuration, settings);
                bool connected = await uaClient.ConnectAsync(ct).ConfigureAwait(false);

                if (connected)
                {
                    uaClient.ReconnectPeriod = 1000;
                    uaClient.ReconnectPeriodExponentialBackoff = 10000;
                    uaClient.Session.MinPublishRequestCount = 3;
                    uaClient.Session.TransferSubscriptionsOnReconnect = true;
                }
                else
                {
                    logger.LogError("Could not connect to server!");
                }

                return uaClient;
            }
            catch (Exception e)
            {
                logger.LogError($"Unexpected Exception [{e.GetType().Name}] {e.Message}");
                return null;
            }
        }

        #region Public Methods
        /// <summary>
        /// Creates a session with the UA server
        /// </summary>
        public async Task<bool> ConnectAsync(CancellationToken ct)
        {
            try
            {
                if (m_session != null && m_session.Connected == true)
                {
                    m_logger.LogInformation("Session already connected!");
                }
                else
                {
                    ITransportWaitingConnection connection = null;
                    m_logger.LogInformation("Connecting to... {0}", m_settings.ServerUrl);
                    var endpointDescription = CoreClientUtils.SelectEndpoint(m_configuration, m_settings.ServerUrl, !m_settings.NoSecurity);

                    var endpointConfiguration = EndpointConfiguration.Create(m_configuration);
                    var endpoint = new ConfiguredEndpoint(null, endpointDescription, endpointConfiguration);
                    var sessionFactory = TraceableSessionFactory.Instance;

                    var policy = endpointDescription.UserIdentityTokens
                        .Where(x => x.TokenType == (m_settings.UserIdentity?.TokenType ?? UserTokenType.Anonymous))
                        .FirstOrDefault();

                    m_settings.UserIdentity.PolicyId = policy?.PolicyId;

                    var session = await sessionFactory.CreateAsync(
                        m_configuration,
                        endpoint,
                        connection == null,
                        false,
                        m_configuration.ApplicationName,
                        m_settings.SessionLifeTime,
                        m_settings.UserIdentity,
                        null,
                        ct
                    ).ConfigureAwait(false);

                    // Assign the created session
                    if (session != null && session.Connected)
                    {
                        m_session = session;

                        // override keep alive interval
                        m_session.KeepAliveInterval = m_settings.KeepAliveInterval;

                        // support transfer
                        m_session.DeleteSubscriptionsOnClose = false;
                        m_session.TransferSubscriptionsOnReconnect = true;

                        // set up keep alive callback.
                        m_session.KeepAlive += Session_KeepAlive;

                        // prepare a reconnect handler
                        m_reconnectHandler = new SessionReconnectHandler(true, ReconnectPeriodExponentialBackoff);
                    }
                }

                return true;
            }
            catch (Exception ex)
            {
                m_logger.LogError("Create Session Error : {0}", ex.Message);
                return false;
            }
        }

        /// <summary>
        /// Disconnects the session.
        /// </summary>
        public void Disconnect()
        {
            try
            {
                if (m_session != null)
                {
                    m_logger.LogInformation("Disconnecting...");

                    lock (m_lock)
                    {
                        m_session.KeepAlive -= Session_KeepAlive;
                        m_reconnectHandler?.Dispose();
                        m_reconnectHandler = null;
                    }

                    m_session.Close();
                    m_session.Dispose();
                    m_session = null;

                    // Log Session Disconnected event
                    m_logger.LogInformation("Session Disconnected.");
                }
                else
                {
                    m_logger.LogInformation("Session not created!");
                }
            }
            catch (Exception ex)
            {
                m_logger.LogError($"Disconnect Error : {ex.Message}");
            }
        }

        private void Session_KeepAlive(ISession session, KeepAliveEventArgs e)
        {
            try
            {
                // start reconnect sequence on communication error.
                if (ServiceResult.IsBad(e.Status))
                {
                    if (ReconnectPeriod <= 0)
                    {
                        Utils.LogWarning("KeepAlive status {0}, but reconnect is disabled.", e.Status);
                        return;
                    }

                    if (m_session != null && m_reconnectHandler != null)
                    {
                        var state = m_reconnectHandler.BeginReconnect(m_session, null, ReconnectPeriod, Client_ReconnectComplete);

                        if (state == SessionReconnectHandler.ReconnectState.Triggered)
                        {
                            Utils.LogInfo("KeepAlive status {0}, reconnect status {1}, reconnect period {2}ms.", e.Status, state, ReconnectPeriod);
                        }
                        else
                        {
                            Utils.LogInfo("KeepAlive status {0}, reconnect status {1}.", e.Status, state);
                        }
                    }

                    return;
                }
            }
            catch (Exception exception)
            {
                Utils.LogError(exception, "Error in OnKeepAlive.");
            }
        }

        /// <summary>
        /// Called when the reconnect attempt was successful.
        /// </summary>
        private void Client_ReconnectComplete(object sender, EventArgs e)
        {
            // ignore callbacks from discarded objects.
            if (!Object.ReferenceEquals(sender, m_reconnectHandler))
            {
                return;
            }

            lock (m_lock)
            {
                // if session recovered, Session property is null
                if (m_reconnectHandler?.Session != null)
                {
                    // ensure only a new instance is disposed
                    // after reactivate, the same session instance may be returned
                    if (!Object.ReferenceEquals(m_session, m_reconnectHandler.Session))
                    {
                        m_logger.LogWarning("--- RECONNECTED TO NEW SESSION --- {0}", m_reconnectHandler.Session.SessionId);
                        var session = m_session;
                        m_session = m_reconnectHandler.Session;
                        Utils.SilentDispose(session);
                    }
                    else
                    {
                        m_logger.LogWarning("--- REACTIVATED SESSION --- {0}", m_reconnectHandler.Session.SessionId);
                    }
                }
                else
                {
                    m_logger.LogWarning("--- RECONNECT KeepAlive recovered ---");
                }
            }
        }
        #endregion

        #region Protected Methods
        /// <summary>
        /// Handles the certificate validation event.
        /// This event is triggered every time an untrusted certificate is received from the server.
        /// </summary>
        protected virtual void CertificateValidation(CertificateValidator sender, CertificateValidationEventArgs e)
        {
            bool certificateAccepted = false;

            // ****
            // Implement a custom logic to decide if the certificate should be
            // accepted or not and set certificateAccepted flag accordingly.
            // The certificate can be retrieved from the e.Certificate field
            // ***

            ServiceResult error = e.Error;
            m_logger.LogError(error.ToString());
            if (error.StatusCode == StatusCodes.BadCertificateUntrusted && m_settings.AutoAccept)
            {
                certificateAccepted = true;
            }

            if (certificateAccepted)
            {
                m_logger.LogWarning("Untrusted Certificate accepted. Subject = {0}", e.Certificate.Subject);
                e.Accept = true;
            }
            else
            {
                m_logger.LogWarning("Untrusted Certificate rejected. Subject = {0}", e.Certificate.Subject);
            }
        }
        #endregion
    }

    public class UAClientSettings
    {
        /// <summary>
        /// The session keepalive interval to be used in ms.
        /// </summary>
        public int KeepAliveInterval { get; set; } = 5000;

        /// <summary>
        /// The session lifetime.
        /// </summary>
        public uint SessionLifeTime { get; set; } = 60 * 1000;

        /// <summary>
        /// Auto accept untrusted certificates.
        /// </summary>
        public bool AutoAccept { get; set; } = false;

        /// <summary>
        /// True if security should not be used.
        /// </summary>
        public bool NoSecurity { get; set; } = false;

        /// <summary>
        /// The user identity.
        /// </summary>
        public UserIdentity UserIdentity { get; set; } = new UserIdentity();

        /// <summary>
        /// The URL of the server to connect to.
        /// </summary>
        public string ServerUrl { get; set; } = "opc.tcp://localhost:62541/";
    }
}