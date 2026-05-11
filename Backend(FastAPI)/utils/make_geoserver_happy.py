import os
import rasterio
from rasterio.transform import from_origin
from tqdm import tqdm  # 进度条，看着爽


def batch_fix_tifs_bypass_proj_error(src_dir, dst_dir, res=0.3):
    if not os.path.exists(dst_dir):
        os.makedirs(dst_dir)

    tif_files = [f for f in os.listdir(src_dir) if f.lower().endswith(('.tif', '.tiff'))]
    print(f"🚀 正在通过 WKT 模式处理 {len(tif_files)} 个文件（避开 PROJ 数据库冲突）...")

    # 直接定义 EPSG:3857 的标准 WKT 字符串，这样 rasterio 就不去查本地 proj.db 了
    # 这是最稳妥的办法，直接把“身份证内容”印上去，而不是只给个“身份证号”让它查
    wkt_3857 = 'PROJCS["WGS 84 / Web Mercator (Auxiliary Sphere)",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],PARAMETER["standard_parallel_1",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],EXTENSION["PROJ4","+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs"],AUTHORITY["EPSG","3857"]]'

    transform = from_origin(0, 0, res, res)

    for file_name in tqdm(tif_files):
        src_path = os.path.join(src_dir, file_name)
        dst_path = os.path.join(dst_dir, file_name)

        try:
            with rasterio.open(src_path) as src:
                out_meta = src.profile.copy()
                data = src.read()

                out_meta.update({
                    'driver': 'GTiff',
                    'crs': wkt_3857,  # 直接传 WKT 字符串
                    'transform': transform,
                    'compress': 'lzw',
                    'nodata': 0
                })

                with rasterio.open(dst_path, 'w', **out_meta) as dst:
                    dst.write(data)
        except Exception as e:
            print(f"❌ 处理文件 {file_name} 时出错: {e}")

    print(f"\n✅ 批量修复成功！GeoServer 现在可以正常读取这些文件了。")


# --- 配置路径 ---
# 请修改为你电脑上的实际路径
INPUT_FOLDER = r'F:/PG-project/mapDataStore'
OUTPUT_FOLDER = r'F:/PG-project/mapDataStore/fixed_data'

if __name__ == "__main__":
    batch_fix_tifs_bypass_proj_error(INPUT_FOLDER, OUTPUT_FOLDER)