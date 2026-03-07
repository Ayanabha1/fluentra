import os
import boto3
import requests
from botocore.config import Config as BotoConfig
from dotenv import load_dotenv

load_dotenv()

S3_BUCKET = os.environ.get('S3_BUCKET')
S3_REGION = os.environ.get('AWS_REGION', 'ap-south-1')

s3 = boto3.client(
    's3',
    region_name=S3_REGION,
    endpoint_url=f"https://s3.{S3_REGION}.amazonaws.com",
    aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY'),
    config=BotoConfig(signature_version='s3v4', s3={'addressing_style': 'virtual'}),
)

key = "recordings/test/test_upload.webm"

print(f"Generating presigned URL for {S3_BUCKET}/{key}...")
upload_url = s3.generate_presigned_url(
    'put_object',
    Params={
        'Bucket': S3_BUCKET,
        'Key': key,
        'ContentType': 'audio/webm',
    },
    ExpiresIn=600,
)

print(f"Generated URL: {upload_url[:100]}...")

print("Uploading dummy data to the presigned URL...")
dummy_data = b"This is a test webm file content."

response = requests.put(
    upload_url,
    data=dummy_data,
    headers={'Content-Type': 'audio/webm'}
)

if response.status_code == 200:
    print("Upload successful!")
else:
    print(f"Upload failed: {response.status_code} - {response.text}")
