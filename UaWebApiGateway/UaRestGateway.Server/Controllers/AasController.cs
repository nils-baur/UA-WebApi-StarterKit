using AasCore.Aas3_0;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Opc.Ua;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Nodes;
using UaRestGateway.Server.Model;
using UaRestGateway.Server.Service;
using UaRestGateway.Server.Service.AAS;
using ISession = Opc.Ua.Client.ISession;
using StatusCodes = Opc.Ua.StatusCodes;


namespace UaRestGateway.Server.Controllers
{
    [ApiController]
    public class AasController : ControllerBase
    {
        private readonly ILogger<AasController> _logger;
        private readonly IAASCommunicationService _aasCommunicationService;
        private readonly IBase64UrlDecoderService _decoderService;

        public AasController(ILogger<AasController> logger, IAASCommunicationService aasCommunicationService, IBase64UrlDecoderService decoderService)
        {
            _logger = logger;
            _aasCommunicationService = aasCommunicationService;
            _decoderService = decoderService;
        }

        public class SubmodelElementInfo
        {
            ISubmodelElement SubmodelElement { get; set; }
            bool IsOpcUa { get; set; }
            NodeId NodeId { get; set; }

            public SubmodelElementInfo(ISubmodelElement submodelElement, bool isOpcUa, NodeId nodeId)
            {
                SubmodelElement = submodelElement;
                IsOpcUa = isOpcUa;
                NodeId = nodeId;
            }
        }

        [HttpGet]
        [Route("/api/v3.0/shells/{aasIdentifier}/submodels/{submodelIdentifier}/submodel-elements/{idShortPath}/info")]
        public virtual async Task<IActionResult> GetSubmodelElementInfoAsync([FromRoute][Required] string aasIdentifier, [FromRoute][Required] string submodelIdentifier, [FromRoute][Required] string idShortPath)
        {
            var decodedAasId = _decoderService.Decode("aasIdentifier", aasIdentifier);
            var decodedSubmodelId = _decoderService.Decode("submodelIdentifier", submodelIdentifier);

            _logger.LogDebug($"Received REST request to get sme {idShortPath}");

            var (element, isOpcUa, nodeId) = await _aasCommunicationService.GetSubmodelElementInfoAsync(decodedAasId, decodedSubmodelId, idShortPath).ConfigureAwait(false);

            var output = new SubmodelElementInfo(element, isOpcUa, nodeId);

            var outputJson = new JsonObject();
            outputJson["submodelElement"] = Jsonization.Serialize.ToJsonObject(element);
            outputJson["isOpcUa"] = isOpcUa;
            if (isOpcUa)
            {
                outputJson["nodeId"] = nodeId.ToString(); 
            }

            return Ok(outputJson);
        }

    }
}
