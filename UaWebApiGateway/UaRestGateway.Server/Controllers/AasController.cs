using AasCore.Aas3_0;
using Microsoft.AspNetCore.Mvc;
using Opc.Ua;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Nodes;
using UaRestGateway.Server.Service;
using UaRestGateway.Server.Service.AAS;

namespace UaRestGateway.Server.Controllers
{
    /// <summary>
    /// Exposes AAS-specific endpoints that extend the generated
    /// <see cref="AssetAdministrationShellRepositoryAPIApiController"/> with
    /// operations not covered by the DotAAS Part 2 specification, such as
    /// the /info endpoint used to resolve OPC UA node mappings.
    /// </summary>
    [ApiController]
    public class AasController : ControllerBase
    {
        private readonly ILogger<AasController> _logger;
        private readonly IAASCommunicationService _aasCommunicationService;
        private readonly IBase64UrlDecoderService _decoderService;

        public AasController(
            ILogger<AasController> logger,
            IAASCommunicationService aasCommunicationService,
            IBase64UrlDecoderService decoderService)
        {
            _logger = logger;
            _aasCommunicationService = aasCommunicationService;
            _decoderService = decoderService;
        }

        public class SubmodelElementInfo
        {
            public ISubmodelElement SubmodelElement { get; set; }
            public bool IsOpcUa { get; set; }
            public NodeId NodeId { get; set; }

            public SubmodelElementInfo(ISubmodelElement submodelElement, bool isOpcUa, NodeId nodeId)
            {
                SubmodelElement = submodelElement;
                IsOpcUa = isOpcUa;
                NodeId = nodeId;
            }
        }

        /// <summary>
        /// Returns the submodel element at the given path together with its
        /// OPC UA mapping metadata.
        /// </summary>
        /// <remarks>
        /// The response includes the serialised submodel element, a flag indicating
        /// whether the element is backed by an OPC UA node, and — when it is — the
        /// corresponding OPC UA node ID. Clients use this information to set up
        /// live-value subscriptions via the OPC UA WebSocket channel.
        /// </remarks>
        /// <param name="aasIdentifier">The AAS unique id (UTF8-BASE64-URL-encoded).</param>
        /// <param name="submodelIdentifier">The Submodel unique id (UTF8-BASE64-URL-encoded).</param>
        /// <param name="idShortPath">Dot-separated idShort path to the submodel element.</param>
        /// <response code="200">Submodel element with OPC UA mapping metadata.</response>
        /// <response code="404">AAS, Submodel, or submodel element not found.</response>
        [HttpGet]
        [Route("/api/v3.0/shells/{aasIdentifier}/submodels/{submodelIdentifier}/submodel-elements/{idShortPath}/info")]
        public virtual async Task<IActionResult> GetSubmodelElementInfoAsync(
            [FromRoute][Required] string aasIdentifier,
            [FromRoute][Required] string submodelIdentifier,
            [FromRoute][Required] string idShortPath)
        {
            var decodedAasId = _decoderService.Decode("aasIdentifier", aasIdentifier);
            var decodedSubmodelId = _decoderService.Decode("submodelIdentifier", submodelIdentifier);

            var (element, isOpcUa, nodeId) = await _aasCommunicationService
                .GetSubmodelElementInfoAsync(decodedAasId, decodedSubmodelId, idShortPath)
                .ConfigureAwait(false);

            var outputJson = new JsonObject();
            outputJson["submodelElement"] = Jsonization.Serialize.ToJsonObject(element);
            outputJson["isOpcUa"] = isOpcUa;

            // nodeId is only meaningful and present when the element is OPC UA-backed.
            if (isOpcUa)
            {
                outputJson["nodeId"] = nodeId.ToString();
            }

            return Ok(outputJson);
        }
    }
}