import os
import boto3
from dotenv import load_dotenv

load_dotenv()

S3_BUCKET = os.environ.get('S3_BUCKET')
S3_REGION = os.environ.get('AWS_REGION', 'ap-south-1')

print(f"Bucketc: {S3_BUCKET}")
print(f"Region: {S3_REGION}")

if not S3_BUCKET:
    print("S3_BUCKET not found in .env")
    exit(1)

s3 = boto3.client(
    's3',
    region_name=S3_REGION,
    aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY')
)

cors_configuration = {
    'CORSRules': [{
        'AllowedHeaders': ['*'],
        'AllowedMethods': ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
        'AllowedOrigins': ['*'],
        'ExposeHeaders': ['ETag']
    }]
}

try:
    print(f"Setting CORS on bucket: {S3_BUCKET}")
    s3.put_bucket_cors(Bucket=S3_BUCKET, CORSConfiguration=cors_configuration)
    print("Successfully set CORS rules on S3 bucket.")
except Exception as e:
    print(f"Error setting CORS: {e}")
