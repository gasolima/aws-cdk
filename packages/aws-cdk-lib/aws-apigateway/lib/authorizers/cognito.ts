import { Construct } from 'constructs';
import { IdentitySource } from './identity-source';
import * as cognito from '../../../aws-cognito';
import { Duration, FeatureFlags, Lazy, Names, Stack } from '../../../core';
import { ValidationError } from '../../../core/lib/errors';
import { addConstructMetadata } from '../../../core/lib/metadata-resource';
import { propertyInjectable } from '../../../core/lib/prop-injectable';
import { APIGATEWAY_AUTHORIZER_CHANGE_DEPLOYMENT_LOGICAL_ID } from '../../../cx-api';
import { CfnAuthorizer, CfnAuthorizerProps } from '../apigateway.generated';
import { Authorizer, IAuthorizer } from '../authorizer';
import { AuthorizationType } from '../method';
import { IRestApi } from '../restapi';

/**
 * Properties for CognitoUserPoolsAuthorizer
 */
export interface CognitoUserPoolsAuthorizerProps {
  /**
   * An optional human friendly name for the authorizer. Note that, this is not the primary identifier of the authorizer.
   *
   * @default - the unique construct ID
   */
  readonly authorizerName?: string;

  /**
   * The user pools to associate with this authorizer.
   */
  readonly cognitoUserPools: cognito.IUserPool[];

  /**
   * How long APIGateway should cache the results. Max 1 hour.
   * Disable caching by setting this to 0.
   *
   * @default Duration.minutes(5)
   */
  readonly resultsCacheTtl?: Duration;

  /**
   * The request header mapping expression for the bearer token. This is typically passed as part of the header, in which case
   * this should be `method.request.header.Authorizer` where `Authorizer` is the header containing the bearer token.
   *
   * @see https://docs.aws.amazon.com/apigateway/latest/api/API_CreateAuthorizer.html#apigw-CreateAuthorizer-request-identitySource
   * @default `IdentitySource.header('Authorization')`
   */
  readonly identitySource?: string;
}

/**
 * Cognito user pools based custom authorizer
 *
 * @resource AWS::ApiGateway::Authorizer
 */
@propertyInjectable
export class CognitoUserPoolsAuthorizer extends Authorizer implements IAuthorizer {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-apigateway.CognitoUserPoolsAuthorizer';
  /**
   * The id of the authorizer.
   * @attribute
   */
  public readonly authorizerId: string;

  /**
   * The ARN of the authorizer to be used in permission policies, such as IAM and resource-based grants.
   * @attribute
   */
  public readonly authorizerArn: string;

  /**
   * The authorization type of this authorizer.
   */
  public readonly authorizationType?: AuthorizationType;

  private restApiId?: string;

  private readonly authorizerProps: CfnAuthorizerProps;

  constructor(scope: Construct, id: string, props: CognitoUserPoolsAuthorizerProps) {
    super(scope, id);
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    const restApiId = this.lazyRestApiId();

    const authorizerProps = {
      name: props.authorizerName ?? Names.uniqueId(this),
      restApiId,
      type: 'COGNITO_USER_POOLS',
      providerArns: props.cognitoUserPools.map(userPool => userPool.userPoolArn),
      authorizerResultTtlInSeconds: props.resultsCacheTtl?.toSeconds(),
      identitySource: props.identitySource || IdentitySource.header('Authorization'),
    };

    this.authorizerProps = authorizerProps;

    const resource = new CfnAuthorizer(this, 'Resource', authorizerProps);

    this.authorizerId = resource.ref;
    this.authorizerArn = Stack.of(this).formatArn({
      service: 'execute-api',
      resource: restApiId,
      resourceName: `authorizers/${this.authorizerId}`,
    });
    this.authorizationType = AuthorizationType.COGNITO;
  }

  /**
   * Attaches this authorizer to a specific REST API.
   * @internal
   */
  public _attachToApi(restApi: IRestApi): void {
    if (this.restApiId && this.restApiId !== restApi.restApiId) {
      throw new ValidationError('Cannot attach authorizer to two different rest APIs', restApi);
    }

    this.restApiId = restApi.restApiId;

    const addToLogicalId = FeatureFlags.of(this).isEnabled(APIGATEWAY_AUTHORIZER_CHANGE_DEPLOYMENT_LOGICAL_ID);

    const deployment = restApi.latestDeployment;
    if (deployment && addToLogicalId) {
      deployment.node.addDependency(this);
      deployment.addToLogicalId({
        authorizer: this.authorizerProps,
      });
    }
  }

  /**
   * Returns a token that resolves to the Rest Api Id at the time of synthesis.
   * Throws an error, during token resolution, if no RestApi is attached to this authorizer.
   */
  private lazyRestApiId() {
    return Lazy.string({
      produce: () => {
        if (!this.restApiId) {
          throw new ValidationError(`Authorizer (${this.node.path}) must be attached to a RestApi`, this);
        }
        return this.restApiId;
      },
    });
  }
}
